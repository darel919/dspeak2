use super::connection::WorkerConnection;
use super::diagnostics::{fail_pending, worker_exit_is_unexpected, worker_exited_error};
use super::{NativeMediaState, MEDIA_EVENT_STATE};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::env;
use std::io::{BufRead, BufReader, BufWriter};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

pub(super) fn spawn_worker(
    app: &AppHandle,
    state: &Arc<Mutex<NativeMediaState>>,
    crashed: Arc<AtomicBool>,
    crash_details: Arc<Mutex<Option<Value>>>,
) -> Result<Arc<WorkerConnection>, Value> {
    let worker_path = resolve_worker_path(app)?;
    let mut child = Command::new(&worker_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            json!(format!(
                "native media worker could not start at {}: {error}",
                worker_path.display()
            ))
        })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| json!("native media worker stdin was unavailable"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| json!("native media worker stdout was unavailable"))?;
    let stderr = child.stderr.take();
    let pending = Arc::new(Mutex::new(HashMap::new()));
    let stderr_tail = Arc::new(Mutex::new(VecDeque::new()));
    let connection = Arc::new(WorkerConnection {
        child: Mutex::new(child),
        writer: Mutex::new(BufWriter::new(stdin)),
        pending: pending.clone(),
        next_request: AtomicU64::new(1),
        alive: AtomicBool::new(true),
        shutdown_requested: AtomicBool::new(false),
        forced_termination: AtomicBool::new(false),
        crashed,
        crash_details,
        last_command: Mutex::new(None),
        last_request_id: AtomicU64::new(0),
        last_command_started_at: AtomicU64::new(0),
        command_history: Mutex::new(VecDeque::new()),
        stderr_tail: stderr_tail.clone(),
    });
    let reader_connection = connection.clone();
    let event_app = app.clone();
    let event_state = state.clone();
    thread::Builder::new()
        .name("dspeak-media-worker-events".to_string())
        .spawn(move || read_worker_output(stdout, reader_connection, event_app, event_state))
        .map_err(|error| {
            json!(format!(
                "native media worker reader failed to start: {error}"
            ))
        })?;
    if let Some(stderr) = stderr {
        let event_app = app.clone();
        let stderr_connection = connection.clone();
        thread::Builder::new()
            .name("dspeak-media-worker-log".to_string())
            .spawn(move || read_worker_stderr(stderr, event_app, stderr_connection))
            .map_err(|error| {
                json!(format!(
                    "native media worker logger failed to start: {error}"
                ))
            })?;
    }
    Ok(connection)
}

fn read_worker_stderr(
    stderr: impl std::io::Read,
    app: AppHandle,
    connection: Arc<WorkerConnection>,
) {
    const EVENT_PREFIX: &str = "DSPEAK_NATIVE_EVENT ";
    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
        connection.record_stderr(&line);
        if let Some(serialized) = line.strip_prefix(EVENT_PREFIX) {
            match serde_json::from_str::<Value>(serialized) {
                Ok(value) => emit_worker_event(&app, &value),
                Err(error) => eprintln!(
                    "[dspeak:media-worker] invalid native event bytes={}: {error}",
                    serialized.len()
                ),
            }
        } else {
            eprintln!("[dspeak:media-worker] {line}");
        }
    }
}

fn read_worker_output(
    stdout: impl std::io::Read,
    connection: Arc<WorkerConnection>,
    app: AppHandle,
    state: Arc<Mutex<NativeMediaState>>,
) {
    const MAX_PROTOCOL_LINE_BYTES: usize = 2_000_000;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(bytes_read) => {
                if bytes_read > MAX_PROTOCOL_LINE_BYTES {
                    eprintln!(
                        "[dspeak:media-worker] protocol line exceeded {} bytes: {}",
                        MAX_PROTOCOL_LINE_BYTES, bytes_read
                    );
                    continue;
                }
                let parsed = match serde_json::from_str::<Value>(line.trim()) {
                    Ok(value) => value,
                    Err(error) => {
                        eprintln!(
                            "[dspeak:media-worker] invalid protocol line bytes={bytes_read}: {error}"
                        );
                        continue;
                    }
                };
                if parsed.get("type").and_then(Value::as_str) == Some("response") {
                    let request_id = parsed.get("id").and_then(Value::as_u64);
                    if let Some(request_id) = request_id {
                        let result = if parsed.get("ok") == Some(&Value::Bool(true)) {
                            Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
                        } else {
                            Err(parsed
                                .get("error")
                                .cloned()
                                .unwrap_or_else(|| json!("native media worker request failed")))
                        };
                        if let Ok(mut pending) = connection.pending.lock() {
                            if let Some(sender) = pending.remove(&request_id) {
                                let _ = sender.send(result);
                            }
                        }
                    }
                } else if parsed.get("type").and_then(Value::as_str) == Some("event") {
                    emit_worker_event(&app, &parsed);
                }
            }
            Err(error) => {
                eprintln!("[dspeak:media-worker] worker output read failed: {error}");
                break;
            }
        }
    }
    connection.alive.store(false, Ordering::Release);
    let unexpected = worker_exit_is_unexpected(
        connection.shutdown_requested.load(Ordering::Acquire),
        connection.forced_termination.load(Ordering::Acquire),
    );
    if unexpected {
        connection.crashed.store(true, Ordering::Release);
    }
    let exit_status = connection.reap_status();
    eprintln!("[dspeak:media-worker] worker stdout closed exit_status={exit_status:?}");
    if unexpected {
        let error = worker_exited_error(&connection, exit_status.as_ref());
        connection.mark_crashed(error.clone());
        fail_pending(&connection.pending, error.clone());
        let disconnected = NativeMediaState::default();
        if let Ok(mut current) = state.lock() {
            *current = disconnected.clone();
        }
        let _ = app.emit(MEDIA_EVENT_STATE, &disconnected);
        let _ = app.emit("media:error", error);
    } else {
        fail_pending(
            &connection.pending,
            json!({
                "code": "MEDIA_WORKER_STOPPED",
                "source": "native-media-worker",
                "message": "The native media worker stopped",
                "recoverable": true,
            }),
        );
    }
}

fn emit_worker_event(app: &AppHandle, value: &Value) {
    let event = value
        .get("event")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let payload = value.get("payload").cloned().unwrap_or(Value::Null);
    let name = match event {
        "native-action" => super::MEDIA_EVENT_NATIVE_ACTION,
        "native-receive-event" => super::MEDIA_EVENT_NATIVE_RECEIVE,
        "state" => super::MEDIA_EVENT_STATE,
        "error" => "media:error",
        _ => return,
    };
    let _ = app.emit(name, payload);
}

fn resolve_worker_path(app: &AppHandle) -> Result<PathBuf, Value> {
    if let Some(path) = env::var_os("DSPEAK_MEDIA_WORKER_PATH") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }
    let target = option_env!("DSPEAK_TARGET_TRIPLE").unwrap_or_default();
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        if !target.is_empty() {
            candidates.extend(worker_name_candidates(
                &resource_dir.join("binaries"),
                &format!("dspeak-media-{target}"),
            ));
        }
        candidates.extend(worker_name_candidates(
            &resource_dir.join("binaries"),
            "dspeak-media",
        ));
        candidates.extend(worker_name_candidates(&resource_dir, "dspeak-media"));
    }
    if let Ok(current_exe) = env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            let name = if cfg!(target_os = "windows") {
                "dspeak-media.exe"
            } else {
                "dspeak-media"
            };
            candidates.push(parent.join(name));
            candidates.push(parent.join("../release").join(name));
        }
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| json!("native media worker executable was not found"))
}

fn worker_name_candidates(directory: &std::path::Path, stem: &str) -> Vec<PathBuf> {
    let mut candidates = vec![directory.join(stem)];
    if cfg!(target_os = "windows") {
        candidates.push(directory.join(format!("{stem}.exe")));
    }
    candidates
}
