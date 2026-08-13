use super::state::NativeMediaStore;
use super::types::NativeMediaState;
use super::MEDIA_EVENT_STATE;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

type WorkerResult = Result<Value, Value>;

struct WorkerConnection {
    child: Mutex<Child>,
    writer: Mutex<BufWriter<ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, Sender<WorkerResult>>>>,
    next_request: AtomicU64,
    alive: AtomicBool,
    shutdown_requested: AtomicBool,
}

impl WorkerConnection {
    fn send(&self, command: &str, payload: Value) -> WorkerResult {
        if !self.alive.load(Ordering::Acquire) {
            return Err(json!("native media worker is not running"));
        }
        let request_id = self.next_request.fetch_add(1, Ordering::Relaxed);
        if matches!(
            command,
            "media_shutdown" | "media_prepare_devices" | "media_prepare_capture"
        ) {
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
            return Err(error);
        }
        match receiver.recv_timeout(Duration::from_secs(90)) {
            Ok(result) => result,
            Err(_) => {
                self.pending
                    .lock()
                    .ok()
                    .and_then(|mut pending| pending.remove(&request_id));
                self.alive.store(false, Ordering::Release);
                if let Ok(mut child) = self.child.lock() {
                    let _ = child.kill();
                }
                Err(json!("native media worker request timed out"))
            }
        }
    }

    fn stop(&self) {
        self.alive.store(false, Ordering::Release);
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        fail_pending(&self.pending, json!("native media worker stopped"));
    }

    fn reap(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.wait();
        }
    }
}

#[derive(Default)]
pub(crate) struct MediaWorkerClient {
    connection: Mutex<Option<Arc<WorkerConnection>>>,
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
        if matches!(
            command,
            "media_shutdown" | "media_prepare_devices" | "media_prepare_capture"
        ) {
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

    pub(crate) fn clear_surfaces(&self, app: &AppHandle) {
        let _ = self.call_existing(app, "media_video_surface_clear", json!({}));
    }

    pub(crate) fn call_existing(
        &self,
        _app: &AppHandle,
        command: &str,
        payload: Value,
    ) -> Option<WorkerResult> {
        let connection = self.connection.lock().ok()?.as_ref()?.clone();
        if !connection.alive.load(Ordering::Acquire) {
            return None;
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
        } else if matches!(command, "media_prepare_devices" | "media_prepare_capture")
            && connection.alive.load(Ordering::Acquire)
        {
            connection
                .shutdown_requested
                .store(false, Ordering::Release);
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
        let mut slot = self
            .connection
            .lock()
            .map_err(|_| json!("native media worker connection lock poisoned"))?;
        if let Some(connection) = slot.as_ref() {
            if connection.alive.load(Ordering::Acquire) {
                return Ok((connection.clone(), false));
            }
        }
        let connection = spawn_worker(app, state)?;
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
}

fn spawn_worker(
    app: &AppHandle,
    state: &Arc<Mutex<NativeMediaState>>,
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
    let connection = Arc::new(WorkerConnection {
        child: Mutex::new(child),
        writer: Mutex::new(BufWriter::new(stdin)),
        pending: pending.clone(),
        next_request: AtomicU64::new(1),
        alive: AtomicBool::new(true),
        shutdown_requested: AtomicBool::new(false),
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
        thread::Builder::new()
            .name("dspeak-media-worker-log".to_string())
            .spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    eprintln!("[dspeak:media-worker] {line}");
                }
            })
            .map_err(|error| {
                json!(format!(
                    "native media worker logger failed to start: {error}"
                ))
            })?;
    }
    Ok(connection)
}

fn read_worker_output(
    stdout: impl std::io::Read,
    connection: Arc<WorkerConnection>,
    app: AppHandle,
    state: Arc<Mutex<NativeMediaState>>,
) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let parsed = match serde_json::from_str::<Value>(line.trim()) {
                    Ok(value) => value,
                    Err(error) => {
                        eprintln!("[dspeak:media-worker] invalid protocol line: {error}");
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
    fail_pending(
        &connection.pending,
        json!("native media worker exited unexpectedly"),
    );
    connection.reap();
    if !connection.shutdown_requested.load(Ordering::Acquire) {
        let disconnected = NativeMediaState::default();
        if let Ok(mut current) = state.lock() {
            *current = disconnected.clone();
        }
        let _ = app.emit(MEDIA_EVENT_STATE, &disconnected);
        let _ = app.emit(
            "media:error",
            json!({
                "code": "MEDIA_WORKER_EXITED",
                "source": "native-media-worker",
                "message": "The native media worker exited unexpectedly",
            }),
        );
    }
}

fn fail_pending(pending: &Arc<Mutex<HashMap<u64, Sender<WorkerResult>>>>, error: Value) {
    let requests = pending
        .lock()
        .ok()
        .map(|mut pending| {
            pending
                .drain()
                .map(|(_, sender)| sender)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for sender in requests {
        let _ = sender.send(Err(error.clone()));
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

pub(crate) async fn media_worker_invoke(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    command: String,
    payload: Value,
) -> Result<Value, Value> {
    if !command.starts_with("media_") {
        return Err(json!("native media worker rejected a non-media command"));
    }
    let worker = store.worker.clone();
    let worker_state = store.state.clone();
    let worker_app = app.clone();
    let worker_command = command.clone();
    let worker_is_connected = store
        .state
        .lock()
        .map(|state| state.connected)
        .unwrap_or(false);
    let result = tauri::async_runtime::spawn_blocking(move || {
        if worker_command == "media_shutdown" {
            return worker
                .call_existing(&worker_app, &worker_command, payload)
                .unwrap_or(Ok(Value::Null));
        }
        let can_spawn = matches!(
            worker_command.as_str(),
            "media_initialize" | "media_prepare_devices" | "media_prepare_capture"
        );
        if can_spawn
            && worker_is_connected
            && matches!(
                worker_command.as_str(),
                "media_prepare_devices" | "media_prepare_capture"
            )
        {
            return worker
                .call_existing(&worker_app, &worker_command, payload)
                .unwrap_or_else(|| Err(json!("native media worker is not running")));
        }
        if worker_command == "media_join" {
            return worker.call_with_initialize(
                &worker_app,
                &worker_state,
                &worker_command,
                payload,
            );
        }
        if can_spawn {
            return worker.call(&worker_app, &worker_state, &worker_command, payload);
        }
        worker
            .call_existing(&worker_app, &worker_command, payload)
            .unwrap_or_else(|| Err(json!("native media worker is not running")))
    })
    .await
    .map_err(|error| json!(format!("native media worker task failed: {error}")))?;
    if let Ok(value) = &result {
        sync_parent_state(&store, &command, value);
        if matches!(
            command.as_str(),
            "media_initialize" | "media_join" | "media_leave" | "media_shutdown"
        ) {
            let _ = app.emit(super::MEDIA_EVENT_STATE, value);
        }
    }
    result
}

pub(crate) async fn media_worker_surface_invoke(
    app: AppHandle,
    store: State<'_, NativeMediaStore>,
    command: String,
    payload: Value,
) -> Result<Value, Value> {
    let worker = store.worker.clone();
    let worker_app = app;
    let is_teardown = matches!(
        command.as_str(),
        "media_video_surface_destroy" | "media_video_surface_clear"
    );
    tauri::async_runtime::spawn_blocking(move || {
        worker
            .call_existing(&worker_app, &command, payload)
            .unwrap_or_else(|| {
                if is_teardown {
                    Ok(Value::Null)
                } else {
                    Err(json!("native media worker is not running"))
                }
            })
    })
    .await
    .map_err(|error| json!(format!("native media worker surface task failed: {error}")))?
}

fn sync_parent_state(store: &NativeMediaStore, command: &str, value: &Value) {
    let Ok(mut state) = store.state.lock() else {
        return;
    };
    match command {
        "media_initialize" | "media_join" | "media_leave" => {
            if let Ok(snapshot) = serde_json::from_value::<NativeMediaState>(value.clone()) {
                *state = snapshot;
            }
        }
        "media_shutdown" => *state = NativeMediaState::default(),
        "media_set_topology" => state.topology = value.get("topology").cloned(),
        "media_set_ice_servers" => {
            state.ice_servers = value
                .get("iceServers")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
        }
        _ => {}
    }
}
