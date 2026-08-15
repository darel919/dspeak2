use super::diagnostics::{
    current_time_millis, fail_pending, worker_connection_can_be_replaced, worker_exited_error,
};
use super::WorkerResult;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufWriter, Write};
use std::process::{Child, ChildStdin, ExitStatus};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

const MAX_COMMAND_HISTORY: usize = 10;
const MAX_STDERR_TAIL_LINES: usize = 80;
const MAX_STDERR_LINE_CHARS: usize = 2048;
const MAX_NATIVE_CRASH_LINES: usize = 66;

pub(super) struct CommandBreadcrumb {
    command: String,
    request_id: u64,
    started_at_ms: u64,
}

pub(super) struct WorkerConnection {
    pub(super) child: Mutex<Child>,
    pub(super) writer: Mutex<BufWriter<ChildStdin>>,
    pub(super) pending: Arc<Mutex<HashMap<u64, Sender<WorkerResult>>>>,
    pub(super) next_request: AtomicU64,
    pub(super) alive: AtomicBool,
    pub(super) shutdown_requested: AtomicBool,
    pub(super) forced_termination: AtomicBool,
    pub(super) crashed: Arc<AtomicBool>,
    pub(super) crash_details: Arc<Mutex<Option<Value>>>,
    pub(super) fatal_event_emitted: Arc<AtomicBool>,
    pub(super) last_command: Mutex<Option<String>>,
    pub(super) last_request_id: AtomicU64,
    pub(super) last_command_started_at: AtomicU64,
    pub(super) command_history: Mutex<VecDeque<CommandBreadcrumb>>,
    pub(super) stderr_tail: Arc<Mutex<VecDeque<String>>>,
    pub(super) native_crash_lines: Arc<Mutex<Vec<String>>>,
    pub(super) native_crash_started: AtomicBool,
    pub(super) stderr_drained: Arc<(Mutex<bool>, Condvar)>,
}

impl WorkerConnection {
    pub(super) fn send(&self, command: &str, payload: Value) -> WorkerResult {
        if !self.alive.load(Ordering::Acquire) {
            return Err(self.unavailable_error());
        }
        let request_id = self.next_request.fetch_add(1, Ordering::Relaxed);
        self.record_command(command, request_id);
        if command == "media_shutdown" {
            self.shutdown_requested.store(true, Ordering::Release);
        }
        let (sender, receiver) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|_| json!("native media worker pending request lock poisoned"))?
            .insert(request_id, sender);
        let request = json!({
            "id": request_id,
            "command": command,
            "payload": payload,
        });
        let write_result = self
            .writer
            .lock()
            .map_err(|_| json!("native media worker writer lock poisoned"))
            .and_then(|mut writer| {
                serde_json::to_writer(&mut *writer, &request).map_err(|error| {
                    json!(format!(
                        "native media worker request encoding failed: {error}"
                    ))
                })?;
                writer.write_all(b"\n").map_err(|error| {
                    json!(format!("native media worker request write failed: {error}"))
                })?;
                writer.flush().map_err(|error| {
                    json!(format!("native media worker request flush failed: {error}"))
                })
            });
        if let Err(error) = write_result {
            self.pending
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&request_id));
            self.alive.store(false, Ordering::Release);
            if command == "media_shutdown" {
                return Err(json!({
                    "code": "MEDIA_WORKER_STOPPED",
                    "source": "native-media-worker",
                    "message": "The native media worker stopped while shutting down",
                    "recoverable": true,
                }));
            }
            self.forced_termination.store(true, Ordering::Release);
            let connection_error = json!({
                "code": "MEDIA_WORKER_EXITED",
                "source": "native-media-worker",
                "message": "The native media worker connection failed",
                "recoverable": false,
                "details": {
                    "reason": "request-write-failed",
                    "command": command,
                    "requestId": request_id,
                    "error": error,
                },
            });
            self.mark_crashed(connection_error.clone());
            if let Ok(mut child) = self.child.lock() {
                let _ = child.kill();
            }
            return Err(connection_error);
        }
        match receiver.recv_timeout(Duration::from_secs(90)) {
            Ok(result) => result,
            Err(_) => {
                self.pending
                    .lock()
                    .ok()
                    .and_then(|mut pending| pending.remove(&request_id));
                self.alive.store(false, Ordering::Release);
                self.forced_termination.store(true, Ordering::Release);
                let timeout_error = json!({
                    "code": "MEDIA_WORKER_EXITED",
                    "source": "native-media-worker",
                    "message": "The native media worker request timed out and the worker was terminated",
                    "recoverable": false,
                    "details": {
                        "reason": "request-timeout",
                        "command": command,
                        "requestId": request_id,
                    },
                });
                self.mark_crashed(timeout_error.clone());
                if let Ok(mut child) = self.child.lock() {
                    let _ = child.kill();
                }
                Err(timeout_error)
            }
        }
    }

    pub(super) fn stop(&self) {
        self.shutdown_requested.store(true, Ordering::Release);
        self.alive.store(false, Ordering::Release);
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        fail_pending(&self.pending, json!("native media worker stopped"));
    }

    pub(super) fn reap_status(&self) -> Option<ExitStatus> {
        if let Ok(mut child) = self.child.lock() {
            return child.wait().ok();
        }
        None
    }

    pub(super) fn reap(&self) {
        let _ = self.reap_status();
    }

    pub(super) fn unavailable_error(&self) -> Value {
        if self.crashed.load(Ordering::Acquire) {
            return self.crashed_error();
        }
        if !worker_connection_can_be_replaced(
            self.shutdown_requested.load(Ordering::Acquire),
            self.forced_termination.load(Ordering::Acquire),
        ) {
            let error = worker_exited_error(self, None);
            self.mark_crashed(error.clone());
            return error;
        }
        json!({
            "code": "MEDIA_WORKER_NOT_RUNNING",
            "source": "native-media-worker",
            "message": "The native media worker is not running",
            "recoverable": false,
        })
    }

    pub(super) fn crashed_error(&self) -> Value {
        self.crash_details
            .lock()
            .ok()
            .and_then(|details| details.clone())
            .unwrap_or_else(|| worker_exited_error(self, None))
    }

    pub(super) fn mark_crashed(&self, error: Value) {
        self.crashed.store(true, Ordering::Release);
        if let Ok(mut details) = self.crash_details.lock() {
            *details = Some(error);
        }
    }

    pub(super) fn wait_for_stderr(&self) {
        let (complete, wake) = &*self.stderr_drained;
        let Ok(complete) = complete.lock() else {
            return;
        };
        let _ = wake.wait_timeout_while(complete, Duration::from_millis(500), |done| !*done);
    }

    pub(super) fn claim_fatal_event(&self) -> bool {
        !self.fatal_event_emitted.swap(true, Ordering::AcqRel)
    }

    pub(super) fn record_command(&self, command: &str, request_id: u64) {
        let started_at_ms = current_time_millis();
        if let Ok(mut last_command) = self.last_command.lock() {
            *last_command = Some(command.to_string());
        }
        self.last_request_id.store(request_id, Ordering::Release);
        self.last_command_started_at
            .store(started_at_ms, Ordering::Release);
        if let Ok(mut history) = self.command_history.lock() {
            history.push_back(CommandBreadcrumb {
                command: command.to_string(),
                request_id,
                started_at_ms,
            });
            while history.len() > MAX_COMMAND_HISTORY {
                history.pop_front();
            }
        }
    }

    pub(super) fn command_diagnostics(&self) -> Value {
        let last_command = self
            .last_command
            .lock()
            .ok()
            .and_then(|command| command.clone());
        let request_id = self.last_request_id.load(Ordering::Acquire);
        let started_at_ms = self.last_command_started_at.load(Ordering::Acquire);
        let history = self
            .command_history
            .lock()
            .ok()
            .map(|history| {
                history
                    .iter()
                    .map(|breadcrumb| {
                        json!({
                            "command": breadcrumb.command,
                            "requestId": breadcrumb.request_id,
                            "startedAt": breadcrumb.started_at_ms,
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        json!({
            "lastCommand": last_command,
            "lastRequestId": if request_id == 0 { Value::Null } else { json!(request_id) },
            "lastCommandStartedAt": if started_at_ms == 0 {
                Value::Null
            } else {
                json!(started_at_ms)
            },
            "recentCommands": history,
        })
    }

    pub(super) fn record_stderr(&self, line: &str) {
        let value = line.chars().take(MAX_STDERR_LINE_CHARS).collect::<String>();
        if let Ok(mut tail) = self.stderr_tail.lock() {
            tail.push_back(value.clone());
            while tail.len() > MAX_STDERR_TAIL_LINES {
                tail.pop_front();
            }
        }
        if value.starts_with("[dspeak:crash] native media worker signal=") {
            self.native_crash_started.store(true, Ordering::Release);
        }
        if self.native_crash_started.load(Ordering::Acquire) {
            if let Ok(mut lines) = self.native_crash_lines.lock() {
                if lines.len() < MAX_NATIVE_CRASH_LINES {
                    lines.push(value);
                }
            }
        }
    }

    pub(super) fn stderr_diagnostics(&self) -> Vec<String> {
        self.stderr_tail
            .lock()
            .ok()
            .map(|tail| tail.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub(super) fn native_crash_diagnostics(&self) -> Vec<String> {
        self.native_crash_lines
            .lock()
            .ok()
            .map(|lines| lines.clone())
            .unwrap_or_default()
    }
}
