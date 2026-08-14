use super::connection::WorkerConnection;
use super::diagnostics::{worker_connection_can_be_replaced, worker_exited_error};
use super::process::spawn_worker;
use super::{NativeMediaState, WorkerResult};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

pub(crate) struct MediaWorkerClient {
    pub(super) connection: Mutex<Option<Arc<WorkerConnection>>>,
    pub(super) crashed: Arc<AtomicBool>,
    pub(super) crash_details: Arc<Mutex<Option<Value>>>,
}

impl Default for MediaWorkerClient {
    fn default() -> Self {
        Self {
            connection: Mutex::new(None),
            crashed: Arc::new(AtomicBool::new(false)),
            crash_details: Arc::new(Mutex::new(None)),
        }
    }
}

impl MediaWorkerClient {
    pub(crate) fn call(
        &self,
        app: &AppHandle,
        state: &Arc<Mutex<NativeMediaState>>,
        command: &str,
        payload: Value,
    ) -> WorkerResult {
        let connection = self.connection_for(app, state)?;
        let result = connection.send(command, payload);
        if command == "media_shutdown" {
            connection.alive.store(false, Ordering::Release);
            connection.reap();
        }
        self.remove_if_stopped(&connection);
        result
    }

    pub(crate) fn call_with_initialize(
        &self,
        app: &AppHandle,
        state: &Arc<Mutex<NativeMediaState>>,
        command: &str,
        payload: Value,
    ) -> WorkerResult {
        if self.is_crashed() {
            return Err(self.crashed_error());
        }
        let (connection, spawned) = self.ensure_connection(app, state)?;
        if spawned {
            if let Err(error) = connection.send("media_initialize", json!({ "config": {} })) {
                self.remove_if_stopped(&connection);
                return Err(error);
            }
        }
        let result = connection.send(command, payload);
        self.remove_if_stopped(&connection);
        result
    }

    pub(crate) fn stop(&self) {
        let connection = self.connection.lock().ok().and_then(|mut slot| slot.take());
        if let Some(connection) = connection {
            connection.stop();
        }
    }

    pub(crate) fn call_existing(
        &self,
        _app: &AppHandle,
        command: &str,
        payload: Value,
    ) -> Option<WorkerResult> {
        if self.is_crashed() {
            return Some(Err(self.crashed_error()));
        }
        let connection = self.connection.lock().ok()?.as_ref()?.clone();
        if !connection.alive.load(Ordering::Acquire) {
            return if connection.crashed.load(Ordering::Acquire) {
                Some(Err(connection.crashed_error()))
            } else if worker_connection_can_be_replaced(
                connection.shutdown_requested.load(Ordering::Acquire),
                connection.forced_termination.load(Ordering::Acquire),
            ) {
                None
            } else {
                let error = worker_exited_error(&connection, None);
                connection.mark_crashed(error.clone());
                Some(Err(error))
            };
        }
        let result = connection.send(command, payload);
        if command == "media_shutdown" {
            connection.alive.store(false, Ordering::Release);
            connection.reap();
            if let Ok(mut slot) = self.connection.lock() {
                if slot
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, &connection))
                {
                    *slot = None;
                }
            }
        }
        Some(result)
    }

    fn connection_for(
        &self,
        app: &AppHandle,
        state: &Arc<Mutex<NativeMediaState>>,
    ) -> Result<Arc<WorkerConnection>, Value> {
        self.ensure_connection(app, state)
            .map(|(connection, _)| connection)
    }

    fn ensure_connection(
        &self,
        app: &AppHandle,
        state: &Arc<Mutex<NativeMediaState>>,
    ) -> Result<(Arc<WorkerConnection>, bool), Value> {
        if self.is_crashed() {
            return Err(self.crashed_error());
        }
        let mut slot = self
            .connection
            .lock()
            .map_err(|_| json!("native media worker connection lock poisoned"))?;
        if let Some(connection) = slot.as_ref().cloned() {
            if connection.alive.load(Ordering::Acquire) {
                return Ok((connection.clone(), false));
            }
            if !worker_connection_can_be_replaced(
                connection.shutdown_requested.load(Ordering::Acquire),
                connection.forced_termination.load(Ordering::Acquire),
            ) {
                let error = if connection.crashed.load(Ordering::Acquire) {
                    connection.crashed_error()
                } else {
                    let error = worker_exited_error(&connection, None);
                    connection.mark_crashed(error.clone());
                    error
                };
                return Err(error);
            }
            *slot = None;
        }
        let connection =
            spawn_worker(app, state, self.crashed.clone(), self.crash_details.clone())?;
        if self.is_crashed() {
            connection.stop();
            return Err(self.crashed_error());
        }
        *slot = Some(connection.clone());
        Ok((connection, true))
    }

    fn remove_if_stopped(&self, connection: &Arc<WorkerConnection>) {
        if !connection.alive.load(Ordering::Acquire) {
            if let Ok(mut slot) = self.connection.lock() {
                if slot
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, connection))
                {
                    *slot = None;
                }
            }
        }
    }

    pub(super) fn is_crashed(&self) -> bool {
        self.crashed.load(Ordering::Acquire)
    }

    pub(super) fn crashed_error(&self) -> Value {
        self.crash_details
            .lock()
            .ok()
            .and_then(|details| details.clone())
            .unwrap_or_else(|| {
                json!({
                    "code": "MEDIA_WORKER_EXITED",
                    "source": "native-media-worker",
                    "message": "The native media worker exited unexpectedly",
                    "recoverable": false,
                })
            })
    }

    pub(super) fn not_running_error(&self) -> Value {
        if self.is_crashed() {
            return self.crashed_error();
        }
        json!({
            "code": "MEDIA_WORKER_NOT_RUNNING",
            "source": "native-media-worker",
            "message": "The native media worker is not running",
            "recoverable": false,
        })
    }
}
