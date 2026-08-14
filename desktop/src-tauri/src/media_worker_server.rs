use crate::ffi;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::ffi::{c_void, CStr, CString};
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::ptr;
use std::slice;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{SystemTime, UNIX_EPOCH};

type WorkerResult = Result<Value, Value>;

struct DispatchResult {
    result: WorkerResult,
    shutdown_after: bool,
}

struct EventPump {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

struct WorkerState {
    initialized: bool,
    connected: bool,
    session: Option<Value>,
    topology: Option<Value>,
    ice_servers: Vec<Value>,
    device: *mut ffi::lib_dspeak_media_device_t,
    send_transport: *mut ffi::lib_dspeak_media_send_transport_t,
    recv_transport: *mut ffi::lib_dspeak_media_recv_transport_t,
    producers: BTreeMap<String, *mut ffi::lib_dspeak_media_producer_t>,
    consumers: Vec<*mut ffi::lib_dspeak_media_consumer_t>,
    p2p_handles: HashMap<u64, *mut ffi::lib_dspeak_media_p2p_handle_t>,
    p2p_tracks: HashMap<(u64, String), (String, *mut c_void)>,
    next_handle: u64,
    event_pump: Option<EventPump>,
}

const NATIVE_EVENT_PREFIX: &[u8] = b"DSPEAK_NATIVE_EVENT ";

unsafe impl Send for WorkerState {}

impl Default for WorkerState {
    fn default() -> Self {
        Self {
            initialized: false,
            connected: false,
            session: None,
            topology: None,
            ice_servers: Vec::new(),
            device: ptr::null_mut(),
            send_transport: ptr::null_mut(),
            recv_transport: ptr::null_mut(),
            producers: BTreeMap::new(),
            consumers: Vec::new(),
            p2p_handles: HashMap::new(),
            p2p_tracks: HashMap::new(),
            next_handle: 1,
            event_pump: None,
        }
    }
}

impl WorkerState {
    fn ensure_initialized(&mut self) -> WorkerResult {
        if self.initialized {
            return Ok(Value::Null);
        }
        let result = unsafe { ffi::lib_dspeak_media_initialize() };
        if result != 0 {
            return Err(json!("native media worker initialization failed"));
        }
        self.initialized = true;
        Ok(Value::Null)
    }

    fn start_events(&mut self, output: Arc<Mutex<BufWriter<io::Stderr>>>) -> WorkerResult {
        if self.event_pump.is_some() {
            return Ok(Value::Null);
        }
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let thread = thread::Builder::new()
            .name("dspeak-media-native-events".to_string())
            .spawn(move || {
                while !thread_stop.load(Ordering::Acquire) {
                    drain_events(&output);
                    if thread_stop.load(Ordering::Acquire) {
                        break;
                    }
                    unsafe {
                        ffi::lib_dspeak_media_wait_for_event(1000);
                    }
                }
                drain_events(&output);
            })
            .map_err(|error| json!(format!("native event pump failed to start: {error}")))?;
        self.event_pump = Some(EventPump {
            stop,
            thread: Some(thread),
        });
        Ok(Value::Null)
    }

    fn clear_transports(&mut self) {
        unsafe {
            for consumer in self.consumers.drain(..) {
                if !consumer.is_null() {
                    ffi::lib_dspeak_media_destroy_consumer(consumer);
                }
            }
            for (_, producer) in std::mem::take(&mut self.producers) {
                if !producer.is_null() {
                    ffi::lib_dspeak_media_destroy_producer(producer);
                }
            }
            if !self.recv_transport.is_null() {
                ffi::lib_dspeak_media_destroy_recv_transport(self.recv_transport);
                self.recv_transport = ptr::null_mut();
            }
            if !self.send_transport.is_null() {
                ffi::lib_dspeak_media_destroy_send_transport(self.send_transport);
                self.send_transport = ptr::null_mut();
            }
        }
    }

    fn clear_p2p(&mut self) {
        unsafe {
            for (_, handle) in std::mem::take(&mut self.p2p_handles) {
                if !handle.is_null() {
                    ffi::lib_dspeak_media_p2p_destroy(handle);
                }
            }
        }
        self.p2p_tracks.clear();
    }

    fn stop_captures(&mut self) {
        unsafe {
            let mut error = 0;
            let _ = ffi::lib_dspeak_media_stop_capture(&mut error);
            ffi::lib_dspeak_media_stop_system_audio_capture();
            let _ = ffi::lib_dspeak_media_stop_microphone_capture(&mut error);
            let _ = ffi::lib_dspeak_media_stop_camera_capture(&mut error);
        }
    }

    fn clear_all(&mut self) {
        self.clear_p2p();
        self.clear_transports();
        self.stop_captures();
        unsafe {
            if !self.device.is_null() {
                ffi::lib_dspeak_media_destroy_device(self.device);
                self.device = ptr::null_mut();
            }
        }
    }

    fn shutdown(&mut self) {
        if let Some(mut pump) = self.event_pump.take() {
            pump.stop.store(true, Ordering::Release);
            unsafe {
                ffi::lib_dspeak_media_wake_event();
            }
            if let Some(thread) = pump.thread.take() {
                let _ = thread.join();
            }
        }
        self.clear_all();
        if self.initialized {
            unsafe {
                ffi::lib_dspeak_media_shutdown();
            }
        }
        self.initialized = false;
        self.connected = false;
        self.session = None;
        self.topology = None;
        self.ice_servers.clear();
    }

    fn next_handle(&mut self) -> u64 {
        let handle = self.next_handle;
        self.next_handle = self.next_handle.saturating_add(1);
        handle
    }
}

impl Drop for WorkerState {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub fn run() -> Result<(), String> {
    let output = Arc::new(Mutex::new(BufWriter::new(io::stdout())));
    let event_output = Arc::new(Mutex::new(BufWriter::new(io::stderr())));
    let stdin = io::stdin();
    let state = Arc::new(Mutex::new(WorkerState::default()));
    let reader_state = state.clone();
    let reader_output = output.clone();
    let reader_event_output = event_output.clone();
    let reader = thread::Builder::new()
        .name("dspeak-media-worker-commands".to_string())
        .spawn(move || -> Result<(), String> {
            let reader = BufReader::new(stdin.lock());
            for line in reader.lines() {
                let line = line
                    .map_err(|error| format!("native media worker request read failed: {error}"))?;
                if line.trim().is_empty() {
                    continue;
                }
                let request = match serde_json::from_str::<Value>(&line) {
                    Ok(value) => value,
                    Err(error) => {
                        write_message(
                            &reader_output,
                            &json!({
                                "type": "response",
                                "id": 0,
                                "ok": false,
                                "error": format!("native media worker request JSON was invalid: {error}"),
                            }),
                        )?;
                        continue;
                    }
                };
                let request_id = request.get("id").and_then(Value::as_u64).unwrap_or(0);
                let command = request
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let payload = request.get("payload").cloned().unwrap_or(Value::Null);
                let dispatched = {
                    let mut state = reader_state
                        .lock()
                        .map_err(|_| "native media worker state lock poisoned".to_string())?;
                        dispatch(
                            &mut state,
                            command,
                            payload,
                            reader_event_output.clone(),
                        )
                };
                let response = match &dispatched.result {
                    Ok(value) => json!({
                        "type": "response",
                        "id": request_id,
                        "ok": true,
                        "result": value,
                    }),
                    Err(error) => json!({
                        "type": "response",
                        "id": request_id,
                        "ok": false,
                        "error": error,
                    }),
                };
                write_message(&reader_output, &response)?;
                if dispatched.shutdown_after {
                    if let Ok(mut state) = reader_state.lock() {
                        state.shutdown();
                    }
                    break;
                }
            }
            if let Ok(mut state) = reader_state.lock() {
                state.shutdown();
            }
            Ok(())
        })
        .map_err(|error| format!("native media worker command thread failed to start: {error}"))?;
    reader
        .join()
        .map_err(|_| "native media worker command thread panicked".to_string())??;
    Ok(())
}

fn dispatch(
    state: &mut WorkerState,
    command: &str,
    payload: Value,
    event_output: Arc<Mutex<BufWriter<io::Stderr>>>,
) -> DispatchResult {
    if command == "media_initialize" {
        return initialize(state, event_output);
    }
    if command == "media_shutdown" {
        let result = state.ensure_initialized().and_then(|_| state_value(state));
        return DispatchResult {
            result,
            shutdown_after: true,
        };
    }
    if command == "media_join" {
        return join(state, payload, event_output);
    }
    if command == "media_leave" {
        return DispatchResult {
            result: leave(state),
            shutdown_after: false,
        };
    }
    if command == "media_get_devices" {
        return DispatchResult {
            result: state.ensure_initialized().and_then(|_| capture_devices()),
            shutdown_after: false,
        };
    }
    if command == "media_prepare_devices" {
        return prepare_devices(state);
    }
    if command == "media_prepare_capture" {
        return prepare_capture(state);
    }
    let result: WorkerResult = match command {
        "media_get_capabilities" => state.ensure_initialized().and_then(|_| capabilities()),
        "media_list_capture_sources" => list_capture_sources(state),
        "media_select_capture_source" => select_capture_source(state, payload),
        "media_get_permissions" => get_permissions(state, payload),
        "media_set_topology" => set_topology(state, payload),
        "media_set_ice_servers" => set_ice_servers(state, payload),
        "media_handle_signal" => ready(state),
        "media_close_sfu" => close_sfu(state),
        "media_create_device" => create_device(state, payload),
        "media_create_send_transport" => create_send_transport(state, payload),
        "media_create_recv_transport" => create_recv_transport(state, payload),
        "media_consume" => consume(state, payload),
        "media_set_consumer_enabled" => set_consumer_enabled(state, payload),
        "media_set_consumer_volume" => set_consumer_volume(state, payload),
        "media_close_consumer" => close_consumer(state, payload),
        "media_create_capture_producer" => create_capture_producer(state, payload),
        "media_set_producer_paused" => set_producer_paused(state, payload),
        "media_set_producer_parameters" => set_producer_parameters(state, payload),
        "media_remove_capture_producer" => remove_capture_producer(state, payload),
        "media_p2p_create" => p2p_create(state, payload),
        "media_p2p_destroy" => p2p_destroy(state, payload),
        "media_p2p_create_offer" => p2p_create_offer(state, payload),
        "media_p2p_create_answer" => p2p_create_answer(state, payload),
        "media_p2p_set_remote_description" => p2p_set_remote_description(state, payload),
        "media_p2p_rollback_local_description" => p2p_rollback_local_description(state, payload),
        "media_p2p_add_ice_candidate" => p2p_add_ice_candidate(state, payload),
        "media_p2p_ice_state" => p2p_ice_state(state, payload),
        "media_p2p_restart_ice" => p2p_restart_ice(state, payload),
        "media_p2p_add_track" => p2p_add_track(state, payload),
        "media_p2p_remove_track" => p2p_remove_track(state, payload),
        "media_p2p_replace_track" => p2p_replace_track(state, payload),
        "media_p2p_set_track_parameters" => p2p_set_track_parameters(state, payload),
        "media_p2p_set_audio_stereo" => p2p_set_audio_stereo(state, payload),
        "media_p2p_set_receive_enabled" => p2p_set_receive_enabled(state, payload),
        "media_p2p_set_receive_volume" => p2p_set_receive_volume(state, payload),
        "media_p2p_set_jitter_buffer" => p2p_set_jitter_buffer(state, payload),
        "media_p2p_send_health" => p2p_send_health(state, payload),
        "media_p2p_get_stats" => p2p_get_stats(state, payload),
        "media_complete_connect" => complete_connect(state, payload),
        "media_fail_connect" => fail_connect(state, payload),
        "media_complete_produce" => complete_produce(state, payload),
        "media_fail_produce" => fail_produce(state, payload),
        "media_set_microphone" => set_microphone(state, payload),
        "media_set_microphone_device" => set_microphone_device(state, payload),
        "media_set_camera_device" => set_camera_device(state, payload),
        "media_set_output_device" => set_output_device(state, payload),
        "media_set_local_video_preview" => set_local_video_preview(state, payload),
        "media_set_shared_audio_volume" => set_shared_audio_volume(state, payload),
        "media_set_shared_audio_attenuation" => set_shared_audio_attenuation(state, payload),
        "media_get_audio_levels" => get_audio_levels(state),
        "media_start_microphone_check" => start_microphone_check(state),
        "media_stop_microphone_check" => stop_microphone_check(state),
        "media_set_camera" => set_camera(state, payload),
        "media_start_screen_share" => start_screen_share(state, payload),
        "media_replace_screen_share" => replace_screen_share(state, payload),
        "media_stop_screen_share" => stop_screen_share(state),
        "media_start_system_audio" => start_system_audio(state, payload),
        "media_replace_system_audio" => replace_system_audio(state, payload),
        "media_stop_system_audio" => stop_system_audio(state),
        "media_restart_send_transport_ice" => restart_send_transport_ice(state, payload),
        "media_restart_recv_transport_ice" => restart_recv_transport_ice(state, payload),
        "media_get_transport_stats" => get_transport_stats(state, payload),
        "media_get_producer_stats" => get_producer_stats(state, payload),
        "media_get_consumer_stats" => get_consumer_stats(state, payload),
        "media_replace_producer_track" => replace_producer_track(state, payload),
        "media_set_consumer_jitter_buffer" => set_consumer_jitter_buffer(state, payload),
        "media_get_stats" => get_stats(state),
        _ => Err(json!(format!(
            "native media worker command is unsupported: {command}"
        ))),
    };
    DispatchResult {
        result,
        shutdown_after: false,
    }
}

fn ready(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized().map(|_| Value::Null)
}

fn initialize(
    state: &mut WorkerState,
    event_output: Arc<Mutex<BufWriter<io::Stderr>>>,
) -> DispatchResult {
    let result = state
        .ensure_initialized()
        .and_then(|_| state.start_events(event_output))
        .and_then(|_| state_value(state));
    DispatchResult {
        result,
        shutdown_after: false,
    }
}

fn join(
    state: &mut WorkerState,
    payload: Value,
    event_output: Arc<Mutex<BufWriter<io::Stderr>>>,
) -> DispatchResult {
    let result = state
        .ensure_initialized()
        .and_then(|_| state.start_events(event_output))
        .map(|_| {
            state.connected = true;
            state.session = Some(payload);
            state_value(state).unwrap_or(Value::Null)
        });
    DispatchResult {
        result,
        shutdown_after: false,
    }
}

fn leave(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    state.clear_p2p();
    state.clear_transports();
    state.stop_captures();
    state.connected = false;
    state.session = None;
    state_value(state)
}

fn close_sfu(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    state.clear_transports();
    Ok(Value::Null)
}

fn capabilities() -> WorkerResult {
    let pointer = unsafe { ffi::lib_dspeak_media_get_capabilities() };
    native_json_string(pointer, "native media capabilities")
}

fn state_value(state: &mut WorkerState) -> WorkerResult {
    let capabilities = capabilities()?;
    Ok(json!({
        "initialized": state.initialized,
        "connected": state.connected,
        "session": state.session,
        "topology": state.topology,
        "iceServers": state.ice_servers,
        "capabilities": capabilities,
        "tracks": {},
        "nativeBackendReady": state.initialized,
    }))
}

fn set_topology(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    state.topology = payload.get("topology").cloned();
    Ok(json!({ "topology": state.topology }))
}

fn set_ice_servers(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    state.ice_servers = payload
        .get("iceServers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(json!({ "iceServers": state.ice_servers }))
}

fn prepare_devices(state: &mut WorkerState) -> DispatchResult {
    let result = state
        .ensure_initialized()
        .and_then(|_| capture_devices())
        .map(|devices| devices);
    DispatchResult {
        result,
        shutdown_after: false,
    }
}

fn prepare_capture(state: &mut WorkerState) -> DispatchResult {
    let result = state.ensure_initialized().and_then(|_| {
        let sources = capture_sources()?;
        Ok(json!({
            "capabilities": capabilities()?,
            "sources": sources,
        }))
    });
    DispatchResult {
        result,
        shutdown_after: false,
    }
}

fn list_capture_sources(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    capture_sources()
}

fn capture_sources() -> WorkerResult {
    let pointer = unsafe { ffi::lib_dspeak_media_list_capture_sources() };
    native_json_string(pointer, "native capture sources")
}

fn capture_devices() -> WorkerResult {
    let pointer = unsafe { ffi::lib_dspeak_media_list_capture_devices() };
    native_json_string(pointer, "native capture devices")
}

fn assert_capture_source_available(request: &Value, operation: &str) -> WorkerResult {
    let selection = request
        .get("captureSelection")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            capture_error(
                "DESKTOP_CAPTURE_INVALID_REQUEST",
                operation,
                "A validated desktop capture selection is required",
            )
        })?;
    let source_id = selection
        .get("sourceId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let source_type = selection
        .get("sourceType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let sources = capture_sources()?;
    let available = sources.as_array().is_some_and(|values| {
        values.iter().any(|source| {
            source.get("sourceId").and_then(Value::as_str) == Some(source_id)
                && source.get("sourceType").and_then(Value::as_str) == Some(source_type)
                && source.get("available") == Some(&Value::Bool(true))
        })
    });
    if available {
        return Ok(Value::Null);
    }
    Err(capture_error(
        "DESKTOP_CAPTURE_SOURCE_UNAVAILABLE",
        operation,
        "The selected native capture source is no longer available",
    ))
}

fn select_capture_source(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let source_id = payload
        .get("sourceId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let sources = capture_sources()?;
    let available = sources.as_array().is_some_and(|values| {
        values.iter().any(|source| {
            source.get("sourceId").and_then(Value::as_str) == Some(source_id)
                && source.get("available") == Some(&Value::Bool(true))
        })
    });
    if available {
        Ok(Value::Null)
    } else {
        Err(capture_error(
            "DESKTOP_CAPTURE_SOURCE_UNAVAILABLE",
            "select",
            "The selected native capture source is no longer available",
        ))
    }
}

fn get_permissions(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let kind = payload
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let capabilities = capabilities()?;
    let granted = match kind {
        "microphone" => capability_bool(&capabilities, &["microphone", "nativeMicrophone"]),
        "camera" => capability_bool(&capabilities, &["camera", "nativeCamera"]),
        "screen" | "screenVideo" => capability_bool(
            &capabilities,
            &["nativeScreenShare", "screenVideo", "screenCaptureKit"],
        ),
        "screenAudio" | "systemAudio" => capability_bool(
            &capabilities,
            &["nativeScreenAudio", "screenAudio", "systemAudio"],
        ),
        _ => false,
    };
    Ok(json!(if granted { "granted" } else { "prompt" }))
}

fn capability_bool(value: &Value, names: &[&str]) -> bool {
    names
        .iter()
        .any(|name| value.get(*name).and_then(Value::as_bool).unwrap_or(false))
}

fn create_device(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    state.clear_p2p();
    state.clear_transports();
    if !state.device.is_null() {
        unsafe { ffi::lib_dspeak_media_destroy_device(state.device) };
        state.device = ptr::null_mut();
    }
    let capabilities = payload
        .get("routerRtpCapabilities")
        .and_then(Value::as_str)
        .ok_or_else(|| json!("router RTP capabilities are required"))?;
    let capabilities = CString::new(capabilities)
        .map_err(|_| json!("router RTP capabilities contain a NUL byte"))?;
    let mut error = 0;
    let device = unsafe { ffi::lib_dspeak_media_create_device(capabilities.as_ptr(), &mut error) };
    if device.is_null() {
        return Err(json!(format!(
            "native device creation failed (error {error})"
        )));
    }
    state.device = device;
    let rtp = unsafe { ffi::lib_dspeak_media_device_get_rtp_capabilities(device) };
    let rtp = native_json_string(rtp, "native RTP capabilities")?;
    Ok(json!({
        "handle": 1,
        "rtpCapabilities": rtp,
    }))
}

fn create_send_transport(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    if state.device.is_null() {
        return Err(json!("native device is not ready"));
    }
    if !state.send_transport.is_null() {
        unsafe { ffi::lib_dspeak_media_destroy_send_transport(state.send_transport) };
        state.send_transport = ptr::null_mut();
    }
    let transport = unsafe {
        create_transport(
            state.device,
            payload,
            ffi::lib_dspeak_media_create_send_transport,
        )?
    };
    state.send_transport = transport;
    Ok(json!({ "handle": 2 }))
}

fn create_recv_transport(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    if state.device.is_null() {
        return Err(json!("native device is not ready"));
    }
    if !state.recv_transport.is_null() {
        unsafe { ffi::lib_dspeak_media_destroy_recv_transport(state.recv_transport) };
        state.recv_transport = ptr::null_mut();
    }
    let transport = unsafe {
        create_transport(
            state.device,
            payload,
            ffi::lib_dspeak_media_create_recv_transport,
        )?
    };
    state.recv_transport = transport;
    Ok(json!({ "handle": 3 }))
}

unsafe fn create_transport<T>(
    device: *mut ffi::lib_dspeak_media_device_t,
    payload: Value,
    create: unsafe extern "C" fn(
        *mut ffi::lib_dspeak_media_device_t,
        *const std::ffi::c_char,
        *const std::ffi::c_char,
        *const std::ffi::c_char,
        *const std::ffi::c_char,
        *const std::ffi::c_char,
        *mut i32,
    ) -> *mut T,
) -> Result<*mut T, Value> {
    let id = c_payload_string(&payload, "id")?;
    let ice_parameters = payload
        .get("iceParameters")
        .cloned()
        .unwrap_or(Value::Null)
        .to_string();
    let ice_candidates = payload
        .get("iceCandidates")
        .cloned()
        .unwrap_or(Value::Array(Vec::new()))
        .to_string();
    let dtls_parameters = payload
        .get("dtlsParameters")
        .cloned()
        .unwrap_or(Value::Null)
        .to_string();
    let app_data = payload
        .get("appData")
        .map(Value::to_string)
        .unwrap_or_default();
    let id = CString::new(id).map_err(|_| json!("transport id contains a NUL byte"))?;
    let ice_parameters =
        CString::new(ice_parameters).map_err(|_| json!("ICE parameters contain a NUL byte"))?;
    let ice_candidates =
        CString::new(ice_candidates).map_err(|_| json!("ICE candidates contain a NUL byte"))?;
    let dtls_parameters =
        CString::new(dtls_parameters).map_err(|_| json!("DTLS parameters contain a NUL byte"))?;
    let app_data =
        CString::new(app_data).map_err(|_| json!("transport app data contains a NUL byte"))?;
    let mut error = 0;
    let transport = create(
        device,
        id.as_ptr(),
        ice_parameters.as_ptr(),
        ice_candidates.as_ptr(),
        dtls_parameters.as_ptr(),
        app_data.as_ptr(),
        &mut error,
    );
    if transport.is_null() {
        Err(json!(format!(
            "native transport creation failed (error {error})"
        )))
    } else {
        Ok(transport)
    }
}

fn consume(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    if state.recv_transport.is_null() {
        return Err(json!("native receive transport is not ready"));
    }
    let id = c_payload_string(&payload, "id")?;
    let producer_id = c_payload_string(&payload, "producerId")?;
    let kind = c_payload_string(&payload, "kind")?;
    let rtp_parameters = payload
        .get("rtpParameters")
        .cloned()
        .unwrap_or(Value::Null)
        .to_string();
    let app_data = payload
        .get("appData")
        .cloned()
        .unwrap_or_else(|| json!({}))
        .to_string();
    let id = CString::new(id).map_err(|_| json!("consumer id contains a NUL byte"))?;
    let producer_id =
        CString::new(producer_id).map_err(|_| json!("consumer producer id contains a NUL byte"))?;
    let kind = CString::new(kind).map_err(|_| json!("consumer kind contains a NUL byte"))?;
    let rtp_parameters =
        CString::new(rtp_parameters).map_err(|_| json!("RTP parameters contain a NUL byte"))?;
    let app_data =
        CString::new(app_data).map_err(|_| json!("consumer app data contains a NUL byte"))?;
    let mut error = 0;
    let consumer = unsafe {
        ffi::lib_dspeak_media_consume(
            state.recv_transport,
            id.as_ptr(),
            producer_id.as_ptr(),
            kind.as_ptr(),
            rtp_parameters.as_ptr(),
            app_data.as_ptr(),
            &mut error,
        )
    };
    if consumer.is_null() {
        return Err(json!(format!(
            "native consumer creation failed (error {error})"
        )));
    }
    if unsafe { ffi::lib_dspeak_media_consumer_set_enabled(consumer, false) } != 0 {
        unsafe { ffi::lib_dspeak_media_destroy_consumer(consumer) };
        return Err(json!("native consumer could not be paused before resume"));
    }
    let metadata = consumer_metadata(consumer)?;
    state.consumers.push(consumer);
    Ok(json!({
        "id": metadata.0,
        "producerId": metadata.1,
        "kind": metadata.2,
    }))
}

fn set_consumer_enabled(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let consumer = consumer_pointer(state, payload_string(&payload, "consumerId")?)?;
    let enabled = payload_bool(&payload, "enabled")?;
    let result = unsafe { ffi::lib_dspeak_media_consumer_set_enabled(consumer, enabled) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native consumer enable state could not be changed"))
    }
}

fn set_consumer_volume(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let consumer = consumer_pointer(state, payload_string(&payload, "consumerId")?)?;
    let volume = payload_number(&payload, "volume")?;
    let result = unsafe { ffi::lib_dspeak_media_consumer_set_volume(consumer, volume) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native consumer volume could not be changed"))
    }
}

fn close_consumer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let consumer_id = payload_string(&payload, "consumerId")?;
    let Some(index) = consumer_index(state, &consumer_id) else {
        return Ok(Value::Null);
    };
    let consumer = state.consumers.remove(index);
    unsafe { ffi::lib_dspeak_media_destroy_consumer(consumer) };
    Ok(Value::Null)
}

fn consumer_index(state: &WorkerState, consumer_id: &str) -> Option<usize> {
    state.consumers.iter().position(|consumer| {
        let pointer = unsafe { ffi::lib_dspeak_media_consumer_get_id(*consumer) };
        let matches = if pointer.is_null() {
            false
        } else {
            unsafe { CStr::from_ptr(pointer) }.to_str().ok() == Some(consumer_id)
        };
        if !pointer.is_null() {
            unsafe { ffi::lib_dspeak_media_free_string(pointer) };
        }
        matches
    })
}

fn consumer_pointer(state: &WorkerState, consumer_id: String) -> Result<*mut c_void, Value> {
    consumer_index(state, &consumer_id)
        .map(|index| state.consumers[index] as *mut c_void)
        .ok_or_else(|| json!("native consumer is not owned by this session"))
}

fn consumer_metadata(
    consumer: *mut ffi::lib_dspeak_media_consumer_t,
) -> Result<(String, String, String), Value> {
    Ok((
        native_text(
            unsafe { ffi::lib_dspeak_media_consumer_get_id(consumer) },
            "consumer id",
        )?,
        native_text(
            unsafe { ffi::lib_dspeak_media_consumer_get_producer_id(consumer) },
            "consumer producer id",
        )?,
        native_text(
            unsafe { ffi::lib_dspeak_media_consumer_get_kind(consumer) },
            "consumer kind",
        )?,
    ))
}

fn create_capture_producer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    if state.send_transport.is_null() {
        return Err(json!("native send transport is not ready"));
    }
    let kind = payload_string(&payload, "kind")?;
    if kind != "audio" && kind != "video" {
        return Err(json!("native capture producer kind is invalid"));
    }
    let app_data = payload.get("appData").cloned().unwrap_or_else(|| json!({}));
    let source = app_data
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or(if kind == "audio" { "audio" } else { "screen" })
        .to_string();
    let valid = match kind.as_str() {
        "audio" => matches!(source.as_str(), "audio" | "screen-audio"),
        "video" => matches!(source.as_str(), "camera" | "screen"),
        _ => false,
    };
    if !valid {
        return Err(json!(format!(
            "native capture source '{source}' is invalid for {kind} producer"
        )));
    }
    let producer_key = app_data
        .get("producerKey")
        .and_then(Value::as_str)
        .unwrap_or(&source)
        .to_string();
    if state.producers.contains_key(&producer_key) {
        return Err(json!(format!(
            "native {kind} producer already exists for key '{producer_key}'"
        )));
    }
    let source_c = CString::new(source.clone())
        .map_err(|_| json!("native capture source contains a NUL byte"))?;
    let track = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_get_video_track(source_c.as_ptr())
        } else {
            ffi::lib_dspeak_media_get_audio_track(source_c.as_ptr())
        }
    };
    if track.is_null() {
        return Err(json!(format!("native {kind} capture track is unavailable")));
    }
    let app_data = CString::new(app_data.to_string())
        .map_err(|_| json!("native producer app data contains a NUL byte"))?;
    let mut error = 0;
    let producer = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_produce_video_track(
                state.send_transport,
                track,
                app_data.as_ptr(),
                &mut error,
            )
        } else {
            ffi::lib_dspeak_media_produce_audio_track(
                state.send_transport,
                track,
                app_data.as_ptr(),
                &mut error,
            )
        }
    };
    if producer.is_null() {
        return Err(json!(format!(
            "native producer creation failed (error {error})"
        )));
    }
    let producer_id = native_text(
        unsafe { ffi::lib_dspeak_media_producer_get_id(producer) },
        "producer id",
    );
    match producer_id {
        Ok(producer_id) => {
            state.producers.insert(producer_key, producer);
            Ok(json!({ "id": producer_id }))
        }
        Err(error) => {
            unsafe { ffi::lib_dspeak_media_destroy_producer(producer) };
            Err(error)
        }
    }
}

fn producer_pointer(
    state: &WorkerState,
    source: &str,
) -> Result<*mut ffi::lib_dspeak_media_producer_t, Value> {
    state.producers.get(source).cloned().ok_or_else(|| {
        json!(format!(
            "native producer is not available for source '{source}'"
        ))
    })
}

fn producer_by_id(
    state: &WorkerState,
    producer_id: &str,
) -> Option<*mut ffi::lib_dspeak_media_producer_t> {
    state.producers.values().copied().find(|producer| {
        native_text(
            unsafe { ffi::lib_dspeak_media_producer_get_id(*producer) },
            "producer id",
        )
        .map(|value| value == producer_id)
        .unwrap_or(false)
    })
}

fn set_producer_paused(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload
        .get("producerKey")
        .and_then(Value::as_str)
        .or_else(|| payload.get("source").and_then(Value::as_str))
        .ok_or_else(|| json!("native producer source or key is required"))?;
    let producer = producer_pointer(state, key)?;
    let paused = payload_bool(&payload, "paused")?;
    let result = unsafe { ffi::lib_dspeak_media_producer_set_paused(producer, paused) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native producer pause state update failed"))
    }
}

fn set_producer_parameters(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload
        .get("producerKey")
        .and_then(Value::as_str)
        .or_else(|| payload.get("source").and_then(Value::as_str))
        .ok_or_else(|| json!("native producer source or key is required"))?;
    let producer = producer_pointer(state, key)?;
    let parameters = CString::new(
        payload
            .get("parameters")
            .cloned()
            .unwrap_or(Value::Null)
            .to_string(),
    )
    .map_err(|_| json!("native producer parameters contain a NUL byte"))?;
    let result =
        unsafe { ffi::lib_dspeak_media_producer_set_parameters(producer, parameters.as_ptr()) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native producer RTP parameters update failed"))
    }
}

fn remove_capture_producer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload
        .get("producerKey")
        .and_then(Value::as_str)
        .or_else(|| payload.get("source").and_then(Value::as_str))
        .ok_or_else(|| json!("native producer source or key is required"))?;
    if let Some(producer) = state.producers.remove(key) {
        unsafe { ffi::lib_dspeak_media_destroy_producer(producer) };
    }
    Ok(Value::Null)
}

fn p2p_pointer(
    state: &WorkerState,
    handle: u64,
) -> Result<*mut ffi::lib_dspeak_media_p2p_handle_t, Value> {
    state
        .p2p_handles
        .get(&handle)
        .cloned()
        .filter(|value| !value.is_null())
        .ok_or_else(|| json!("native P2P handle is not owned by this session"))
}

fn p2p_create(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let ice_servers = serde_json::to_string(&state.ice_servers).map_err(|error| {
        json!(format!(
            "native ICE servers could not be serialized: {error}"
        ))
    })?;
    let ice_servers =
        CString::new(ice_servers).map_err(|_| json!("native ICE servers contain a NUL byte"))?;
    let offerer = payload_bool(&payload, "offerer")?;
    let key = state.next_handle();
    let handle = unsafe { ffi::lib_dspeak_media_p2p_create(ice_servers.as_ptr(), offerer, key) };
    if handle.is_null() {
        return Err(json!("native P2P PeerConnection creation failed"));
    }
    state.p2p_handles.insert(key, handle);
    Ok(json!({ "handle": key }))
}

fn p2p_destroy(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload_u64(&payload, "p2pHandle")?;
    let handle = state
        .p2p_handles
        .remove(&key)
        .ok_or_else(|| json!("native P2P handle is not owned by this session"))?;
    state.p2p_tracks.retain(|(owner, _), _| *owner != key);
    unsafe { ffi::lib_dspeak_media_p2p_destroy(handle) };
    Ok(Value::Null)
}

fn p2p_create_offer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let mut output = ptr::null_mut();
    let result = unsafe { ffi::lib_dspeak_media_p2p_create_offer(handle, &mut output) };
    p2p_sdp_result(handle, result, output, "offer")
}

fn p2p_create_answer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let remote_sdp = CString::new(payload_string(&payload, "remoteSdp")?)
        .map_err(|_| json!("remote SDP contains a NUL byte"))?;
    let mut output = ptr::null_mut();
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_create_answer(handle, remote_sdp.as_ptr(), &mut output)
    };
    p2p_sdp_result(handle, result, output, "answer")
}

fn p2p_set_remote_description(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let sdp = CString::new(payload_string(&payload, "sdp")?)
        .map_err(|_| json!("SDP contains a NUL byte"))?;
    let sdp_type = CString::new(payload_string(&payload, "sdpType")?)
        .map_err(|_| json!("SDP type contains a NUL byte"))?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_set_remote_description(handle, sdp_type.as_ptr(), sdp.as_ptr())
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        let native_error = unsafe { ffi::lib_dspeak_media_p2p_last_error(handle) };
        let native_error = if native_error.is_null() {
            "native remote description failed".to_string()
        } else {
            unsafe { CStr::from_ptr(native_error) }
                .to_string_lossy()
                .into_owned()
        };
        Err(json!({
            "code": "NATIVE_P2P_REMOTE_DESCRIPTION_FAILED",
            "message": "native P2P remote description failed",
            "details": {
                "sdpType": sdp_type.to_string_lossy().into_owned(),
                "nativeError": native_error,
            },
        }))
    }
}

fn p2p_rollback_local_description(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let result = unsafe { ffi::lib_dspeak_media_p2p_rollback_local_description(handle) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        let native_error = unsafe { ffi::lib_dspeak_media_p2p_last_error(handle) };
        let native_error = if native_error.is_null() {
            "native local rollback failed".to_string()
        } else {
            unsafe { CStr::from_ptr(native_error) }
                .to_string_lossy()
                .into_owned()
        };
        Err(json!({
            "code": "NATIVE_P2P_LOCAL_ROLLBACK_FAILED",
            "message": "native P2P local description rollback failed",
            "details": { "nativeError": native_error }
        }))
    }
}

fn p2p_add_ice_candidate(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let candidate = CString::new(payload_string(&payload, "candidate")?)
        .map_err(|_| json!("ICE candidate contains a NUL byte"))?;
    let result = unsafe { ffi::lib_dspeak_media_p2p_add_ice_candidate(handle, candidate.as_ptr()) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P ICE candidate failed"))
    }
}

fn p2p_ice_state(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    Ok(json!(unsafe {
        ffi::lib_dspeak_media_p2p_ice_connection_state(handle)
    }))
}

fn p2p_restart_ice(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let mut output = ptr::null_mut();
    let result = unsafe { ffi::lib_dspeak_media_p2p_restart_ice(handle, &mut output) };
    p2p_sdp_result(handle, result, output, "ICE restart")
}

fn p2p_add_track(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload_u64(&payload, "p2pHandle")?;
    let handle = p2p_pointer(state, key)?;
    let source = payload_string(&payload, "source")?;
    let track_key = payload
        .get("trackKey")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| source.clone());
    let kind = payload_string(&payload, "kind")?;
    let preferred_codec = payload
        .get("preferredCodec")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if kind != "audio" && kind != "video" {
        return Err(json!("native P2P track kind is invalid"));
    }
    if state.p2p_tracks.contains_key(&(key, track_key.clone())) {
        return Err(json!("native P2P source is already attached"));
    }
    let source_c =
        CString::new(source.clone()).map_err(|_| json!("native P2P source contains a NUL byte"))?;
    let track = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_get_video_track(source_c.as_ptr())
        } else {
            ffi::lib_dspeak_media_get_audio_track(source_c.as_ptr())
        }
    };
    if track.is_null() {
        return Err(json!(format!("native {kind} capture track is unavailable")));
    }
    let result = unsafe {
        if kind == "video" {
            let preferred = preferred_codec
                .as_deref()
                .map(|value| CString::new(value.to_owned()))
                .transpose()
                .map_err(|error| json!(error.to_string()))?;
            let track_key =
                CString::new(track_key.clone()).map_err(|error| json!(error.to_string()))?;
            ffi::lib_dspeak_media_p2p_add_video_track_with_key(
                handle,
                track,
                preferred
                    .as_ref()
                    .map_or(ptr::null(), |value| value.as_ptr()),
                track_key.as_ptr(),
            )
        } else {
            let track_key =
                CString::new(track_key.clone()).map_err(|error| json!(error.to_string()))?;
            ffi::lib_dspeak_media_p2p_add_audio_track_with_key(handle, track, track_key.as_ptr())
        }
    };
    if result != 0 {
        return Err(json!(format!("native P2P {kind} track attachment failed")));
    }
    let track_id = track_id(track, &kind)?;
    state.p2p_tracks.insert((key, track_key), (kind, track));
    Ok(json!({ "trackId": track_id }))
}

fn p2p_remove_track(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload_u64(&payload, "p2pHandle")?;
    let handle = p2p_pointer(state, key)?;
    let source = payload_string(&payload, "source")?;
    let track_key = payload
        .get("trackKey")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| source.clone());
    let (kind, track) = state
        .p2p_tracks
        .get(&(key, track_key.clone()))
        .cloned()
        .ok_or_else(|| json!("native P2P source is not attached"))?;
    let result = unsafe {
        if kind == "video" {
            let track_key =
                CString::new(track_key.clone()).map_err(|error| json!(error.to_string()))?;
            ffi::lib_dspeak_media_p2p_remove_video_track_with_key(handle, track, track_key.as_ptr())
        } else {
            let track_key =
                CString::new(track_key.clone()).map_err(|error| json!(error.to_string()))?;
            ffi::lib_dspeak_media_p2p_remove_audio_track_with_key(handle, track, track_key.as_ptr())
        }
    };
    if result != 0 {
        return Err(json!(format!("native P2P {kind} track removal failed")));
    }
    state.p2p_tracks.remove(&(key, track_key));
    Ok(Value::Null)
}

fn p2p_replace_track(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload_u64(&payload, "p2pHandle")?;
    let handle = p2p_pointer(state, key)?;
    let source = payload_string(&payload, "source")?;
    let kind = payload_string(&payload, "kind")?;
    let track_key = payload
        .get("trackKey")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| source.clone());
    let (attached_kind, old_track) = state
        .p2p_tracks
        .get(&(key, track_key.clone()))
        .cloned()
        .ok_or_else(|| json!("native P2P source is not attached"))?;
    if attached_kind != kind {
        return Err(json!("native P2P replacement track kind does not match"));
    }
    let source_c =
        CString::new(source).map_err(|_| json!("native P2P source contains a NUL byte"))?;
    let new_track = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_get_video_track(source_c.as_ptr())
        } else if kind == "audio" {
            ffi::lib_dspeak_media_get_audio_track(source_c.as_ptr())
        } else {
            ptr::null_mut()
        }
    };
    if new_track.is_null() {
        return Err(json!(format!(
            "native P2P {kind} capture track is unavailable"
        )));
    }
    if new_track != old_track {
        let result = unsafe {
            if kind == "video" {
                let track_key =
                    CString::new(track_key.clone()).map_err(|error| json!(error.to_string()))?;
                ffi::lib_dspeak_media_p2p_replace_video_track_with_key(
                    handle,
                    old_track,
                    new_track,
                    track_key.as_ptr(),
                )
            } else {
                let track_key =
                    CString::new(track_key.clone()).map_err(|error| json!(error.to_string()))?;
                ffi::lib_dspeak_media_p2p_replace_audio_track_with_key(
                    handle,
                    old_track,
                    new_track,
                    track_key.as_ptr(),
                )
            }
        };
        if result != 0 {
            return Err(json!(format!("native P2P {kind} track replacement failed")));
        }
    }
    let track_id = track_id(new_track, &kind)?;
    state.p2p_tracks.insert((key, track_key), (kind, new_track));
    Ok(json!({ "trackId": track_id }))
}

fn p2p_set_track_parameters(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let key = payload_u64(&payload, "p2pHandle")?;
    let handle = p2p_pointer(state, key)?;
    let source = payload_string(&payload, "source")?;
    let track_key = payload
        .get("trackKey")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| source.clone());
    let (kind, track) = state
        .p2p_tracks
        .get(&(key, track_key.clone()))
        .cloned()
        .ok_or_else(|| json!("native P2P source is not attached"))?;
    if track.is_null() {
        return Err(json!(format!("native P2P {kind} track is invalid")));
    }
    let parameters = CString::new(
        payload
            .get("parameters")
            .cloned()
            .unwrap_or(Value::Null)
            .to_string(),
    )
    .map_err(|_| json!("native P2P parameters contain a NUL byte"))?;
    let track_key =
        CString::new(track_key).map_err(|_| json!("native P2P track key contains a NUL byte"))?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_set_track_parameters_with_key(
            handle,
            track_key.as_ptr(),
            parameters.as_ptr(),
        )
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P sender RTP parameters update failed"))
    }
}

fn p2p_set_audio_stereo(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let stereo = payload_bool(&payload, "stereo")?;
    let result = unsafe { ffi::lib_dspeak_media_p2p_set_audio_stereo(handle, stereo) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P audio profile update failed"))
    }
}

fn p2p_set_receive_enabled(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let track_id = CString::new(payload_string(&payload, "trackId")?)
        .map_err(|_| json!("native P2P track id contains a NUL byte"))?;
    let enabled = payload_bool(&payload, "enabled")?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_set_receive_enabled(handle, track_id.as_ptr(), enabled)
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P receive state update failed"))
    }
}

fn p2p_set_receive_volume(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let track_id = CString::new(payload_string(&payload, "trackId")?)
        .map_err(|_| json!("native P2P track id contains a NUL byte"))?;
    let volume = payload_number(&payload, "volume")?;
    let result =
        unsafe { ffi::lib_dspeak_media_p2p_set_receive_volume(handle, track_id.as_ptr(), volume) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P receive volume update failed"))
    }
}

fn p2p_set_jitter_buffer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let track_id = CString::new(payload_string(&payload, "trackId")?)
        .map_err(|_| json!("native P2P track id contains a NUL byte"))?;
    let min_delay = payload_i32(&payload, "minDelayMs")?;
    let target_delay = payload_i32(&payload, "targetDelayMs")?;
    let result = unsafe {
        ffi::lib_dspeak_media_p2p_set_jitter_buffer(
            handle,
            track_id.as_ptr(),
            min_delay,
            target_delay,
        )
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P jitter buffer configuration failed"))
    }
}

fn p2p_send_health(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let message = CString::new(payload_string(&payload, "message")?)
        .map_err(|_| json!("native P2P health message contains a NUL byte"))?;
    let result = unsafe { ffi::lib_dspeak_media_p2p_send_health(handle, message.as_ptr()) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native P2P health message could not be sent"))
    }
}

fn p2p_get_stats(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let handle = p2p_pointer(state, payload_u64(&payload, "p2pHandle")?)?;
    let pointer = unsafe { ffi::lib_dspeak_media_p2p_get_stats(handle) };
    native_json_string(pointer, "native P2P stats")
}

fn track_id(track: *mut c_void, kind: &str) -> Result<String, Value> {
    let pointer = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_video_track_get_id(track)
        } else {
            ffi::lib_dspeak_media_audio_track_get_id(track)
        }
    };
    native_text(pointer, "native track id")
}

fn p2p_sdp_result(
    handle: *mut ffi::lib_dspeak_media_p2p_handle_t,
    result: i32,
    pointer: *mut std::ffi::c_char,
    operation: &str,
) -> WorkerResult {
    if result != 0 || pointer.is_null() {
        if !pointer.is_null() {
            unsafe { ffi::lib_dspeak_media_free_string(pointer) };
        }
        let native_error = unsafe { ffi::lib_dspeak_media_p2p_last_error(handle) };
        let native_error = if native_error.is_null() {
            "unknown native SDP error".to_string()
        } else {
            unsafe { CStr::from_ptr(native_error) }
                .to_string_lossy()
                .into_owned()
        };
        return Err(json!({
            "code": "NATIVE_P2P_SDP_FAILED",
            "message": format!("native P2P {operation} failed: {native_error}"),
            "details": {
                "operation": operation,
                "nativeError": native_error,
            },
        }));
    }
    native_text(pointer, &format!("native P2P {operation}")).map(Value::String)
}

fn complete_connect(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let pointer = payload_u64(&payload, "transportPtr")? as *mut c_void;
    unsafe { ffi::lib_dspeak_media_complete_connect(pointer) };
    Ok(Value::Null)
}

fn fail_connect(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let pointer = payload_u64(&payload, "transportPtr")? as *mut c_void;
    let error = CString::new(payload_string(&payload, "error")?)
        .map_err(|_| json!("native transport error contains a NUL byte"))?;
    unsafe { ffi::lib_dspeak_media_fail_connect(pointer, error.as_ptr()) };
    Ok(Value::Null)
}

fn complete_produce(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let action_id = payload_u64(&payload, "actionId")?;
    let producer_id = CString::new(payload_string(&payload, "producerId")?)
        .map_err(|_| json!("native producer id contains a NUL byte"))?;
    unsafe { ffi::lib_dspeak_media_complete_produce(action_id, producer_id.as_ptr()) };
    Ok(Value::Null)
}

fn fail_produce(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let action_id = payload_u64(&payload, "actionId")?;
    let error = CString::new(payload_string(&payload, "error")?)
        .map_err(|_| json!("native producer error contains a NUL byte"))?;
    unsafe { ffi::lib_dspeak_media_fail_produce(action_id, error.as_ptr()) };
    Ok(Value::Null)
}

fn set_microphone(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let enabled = payload_bool(&payload, "enabled")?;
    let mut error = 0;
    let result = unsafe {
        if enabled {
            ffi::lib_dspeak_media_start_microphone_capture(&mut error)
        } else {
            ffi::lib_dspeak_media_stop_microphone_capture(&mut error)
        }
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!(format!(
            "native microphone capture failed (error {error})"
        )))
    }
}

fn set_microphone_device(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let device_id = CString::new(payload_string(&payload, "deviceId")?)
        .map_err(|_| json!("microphone device id contains a NUL byte"))?;
    let mut error = 0;
    let result =
        unsafe { ffi::lib_dspeak_media_set_microphone_device(device_id.as_ptr(), &mut error) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!(format!(
            "native microphone device selection failed (error {error})"
        )))
    }
}

fn set_camera_device(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let device_id = CString::new(payload_string(&payload, "deviceId")?)
        .map_err(|_| json!("camera device id contains a NUL byte"))?;
    let mut error = 0;
    let result = unsafe { ffi::lib_dspeak_media_set_camera_device(device_id.as_ptr(), &mut error) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!(format!(
            "native camera device selection failed (error {error})"
        )))
    }
}

fn set_output_device(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let device_id = CString::new(payload_string(&payload, "deviceId")?)
        .map_err(|_| json!("output device id contains a NUL byte"))?;
    let result = unsafe { ffi::lib_dspeak_media_set_output_device(device_id.as_ptr()) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native audio output selection failed"))
    }
}

fn set_local_video_preview(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let source = CString::new(payload_string(&payload, "source")?)
        .map_err(|_| json!("native preview source contains a NUL byte"))?;
    let enabled = payload_bool(&payload, "enabled")?;
    let result = unsafe { ffi::lib_dspeak_media_set_local_video_preview(source.as_ptr(), enabled) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native local video preview could not be changed"))
    }
}

fn set_shared_audio_volume(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let volume = payload_number(&payload, "volume")?;
    let result = unsafe { ffi::lib_dspeak_media_set_shared_audio_volume(volume) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native shared audio volume could not be changed"))
    }
}

fn set_shared_audio_attenuation(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let enabled = payload_bool(&payload, "enabled")?;
    let reduction = payload_number(&payload, "reductionPercent")?;
    let attack = payload_i32(&payload, "attackMs")?;
    let release = payload_i32(&payload, "releaseMs")?;
    let result = unsafe {
        ffi::lib_dspeak_media_set_shared_audio_attenuation(
            i32::from(enabled),
            reduction,
            attack,
            release,
        )
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!(
            "native shared audio attenuation could not be changed"
        ))
    }
}

fn get_audio_levels(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    let pointer = unsafe { ffi::lib_dspeak_media_get_audio_levels() };
    native_json_string(pointer, "native audio telemetry")
}

fn start_microphone_check(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    let result = unsafe { ffi::lib_dspeak_media_start_microphone_check() };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!(format!(
            "native microphone check could not start (error {result})"
        )))
    }
}

fn stop_microphone_check(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    let mut length = 0usize;
    let pointer = unsafe { ffi::lib_dspeak_media_stop_microphone_check(&mut length) };
    if pointer.is_null() {
        return Err(json!("native microphone check returned no recording"));
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length).to_vec() };
    unsafe { ffi::lib_dspeak_media_free_buffer(pointer) };
    Ok(Value::Array(
        bytes
            .into_iter()
            .map(|value| Value::Number(value.into()))
            .collect(),
    ))
}

fn set_camera(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let enabled = payload_bool(&payload, "enabled")?;
    let settings = payload
        .get("videoSettings")
        .cloned()
        .unwrap_or_else(|| json!({}))
        .to_string();
    let settings =
        CString::new(settings).map_err(|_| json!("native camera settings contain a NUL byte"))?;
    let mut error = 0;
    let result = unsafe {
        if enabled {
            ffi::lib_dspeak_media_start_camera_capture(settings.as_ptr(), &mut error)
        } else {
            ffi::lib_dspeak_media_stop_camera_capture(&mut error)
        }
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        let detail = unsafe { ffi::lib_dspeak_media_capture_error_message(error) };
        let detail = if detail.is_null() {
            "native capture failed".to_string()
        } else {
            unsafe { CStr::from_ptr(detail) }
                .to_string_lossy()
                .into_owned()
        };
        Err(json!(format!(
            "native camera capture failed (error {error}): {detail}"
        )))
    }
}

fn start_screen_share(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let request = payload.get("request").cloned().unwrap_or(Value::Null);
    validate_capture_request(&request, "screen-video", "video")?;
    assert_capture_source_available(&request, "screen-video")?;
    let request = CString::new(request.to_string())
        .map_err(|_| json!("capture request contains a NUL byte"))?;
    let mut error = 0;
    let result = unsafe { ffi::lib_dspeak_media_start_capture(request.as_ptr(), &mut error) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(capture_native_error(
            "DESKTOP_CAPTURE_START_FAILED",
            "screen-video",
            error,
        ))
    }
}

fn replace_screen_share(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let request = payload.get("request").cloned().unwrap_or(Value::Null);
    validate_capture_request(&request, "screen-video-replace", "video")?;
    assert_capture_source_available(&request, "screen-video-replace")?;
    let mut error = 0;
    let result = unsafe { ffi::lib_dspeak_media_stop_capture(&mut error) };
    if result != 0 {
        return Err(capture_native_error(
            "DESKTOP_CAPTURE_STOP_FAILED",
            "screen-video-replace",
            error,
        ));
    }
    start_screen_share(state, payload)
}

fn stop_screen_share(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    let mut error = 0;
    let result = unsafe { ffi::lib_dspeak_media_stop_capture(&mut error) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(capture_native_error(
            "DESKTOP_CAPTURE_STOP_FAILED",
            "screen-video",
            error,
        ))
    }
}

fn start_system_audio(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let request = payload.get("request").cloned().unwrap_or(Value::Null);
    validate_capture_request(&request, "system-audio", "audio")?;
    assert_capture_source_available(&request, "system-audio")?;
    let request = CString::new(request.to_string())
        .map_err(|_| json!("capture request contains a NUL byte"))?;
    let mut error = 0;
    let result = unsafe { ffi::lib_dspeak_media_start_capture(request.as_ptr(), &mut error) };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(capture_native_error(
            "DESKTOP_CAPTURE_START_FAILED",
            "system-audio",
            error,
        ))
    }
}

fn replace_system_audio(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let request = payload.get("request").cloned().unwrap_or(Value::Null);
    validate_capture_request(&request, "system-audio-replace", "audio")?;
    assert_capture_source_available(&request, "system-audio-replace")?;
    unsafe { ffi::lib_dspeak_media_stop_system_audio_capture() };
    start_system_audio(state, payload)
}

fn stop_system_audio(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    unsafe { ffi::lib_dspeak_media_stop_system_audio_capture() };
    Ok(Value::Null)
}

fn restart_send_transport_ice(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    if state.send_transport.is_null() {
        return Err(json!("native send transport is not ready"));
    }
    let parameters = CString::new(
        payload
            .get("iceParameters")
            .cloned()
            .unwrap_or(Value::Null)
            .to_string(),
    )
    .map_err(|_| json!("ICE parameters contain a NUL byte"))?;
    let result = unsafe {
        ffi::lib_dspeak_media_send_transport_restart_ice(state.send_transport, parameters.as_ptr())
    };
    if result == 0 {
        Ok(json!({ "restarted": true }))
    } else {
        Err(json!("native send transport ICE restart failed"))
    }
}

fn restart_recv_transport_ice(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    if state.recv_transport.is_null() {
        return Err(json!("native recv transport is not ready"));
    }
    let parameters = CString::new(
        payload
            .get("iceParameters")
            .cloned()
            .unwrap_or(Value::Null)
            .to_string(),
    )
    .map_err(|_| json!("ICE parameters contain a NUL byte"))?;
    let result = unsafe {
        ffi::lib_dspeak_media_recv_transport_restart_ice(state.recv_transport, parameters.as_ptr())
    };
    if result == 0 {
        Ok(json!({ "restarted": true }))
    } else {
        Err(json!("native recv transport ICE restart failed"))
    }
}

fn get_transport_stats(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let direction = payload_string(&payload, "direction")?;
    let pointer = unsafe {
        match direction.as_str() {
            "send" if !state.send_transport.is_null() => {
                ffi::lib_dspeak_media_send_transport_get_stats(state.send_transport)
            }
            "recv" if !state.recv_transport.is_null() => {
                ffi::lib_dspeak_media_recv_transport_get_stats(state.recv_transport)
            }
            "send" | "recv" => return Err(json!("native transport is not ready")),
            _ => return Err(json!(format!("unknown transport direction: {direction}"))),
        }
    };
    native_json_string(pointer, "native transport stats")
}

fn get_producer_stats(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let producer_id = payload_string(&payload, "producerId")?;
    let producer = producer_by_id(state, &producer_id)
        .ok_or_else(|| json!("native producer is not owned by this session"))?;
    let pointer = unsafe { ffi::lib_dspeak_media_producer_get_stats(producer) };
    native_json_string(pointer, "native producer stats")
}

fn get_consumer_stats(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let consumer_id = payload_string(&payload, "consumerId")?;
    let consumer = consumer_pointer(state, consumer_id)?;
    let pointer = unsafe { ffi::lib_dspeak_media_consumer_get_stats(consumer) };
    native_json_string(pointer, "native consumer stats")
}

fn replace_producer_track(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let producer_id = payload_string(&payload, "producerId")?;
    let source = payload_string(&payload, "source")?;
    let kind = payload_string(&payload, "kind")?;
    let producer = producer_by_id(state, &producer_id)
        .ok_or_else(|| json!("native producer is not owned by this session"))?;
    let source =
        CString::new(source).map_err(|_| json!("native capture source contains a NUL byte"))?;
    let track = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_get_video_track(source.as_ptr())
        } else if kind == "audio" {
            ffi::lib_dspeak_media_get_audio_track(source.as_ptr())
        } else {
            ptr::null_mut()
        }
    };
    if track.is_null() {
        return Err(json!("native replacement capture track is unavailable"));
    }
    let mut error = 0;
    let result = unsafe {
        if kind == "video" {
            ffi::lib_dspeak_media_producer_replace_video_track(producer, track, &mut error)
        } else {
            ffi::lib_dspeak_media_producer_replace_audio_track(producer, track, &mut error)
        }
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!(format!(
            "native producer track replacement failed (error {error})"
        )))
    }
}

fn set_consumer_jitter_buffer(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    let consumer_id = payload_string(&payload, "consumerId")?;
    let consumer = consumer_pointer(state, consumer_id)?;
    let min_delay = payload_i32(&payload, "minDelayMs")?;
    let target_delay = payload_i32(&payload, "targetDelayMs")?;
    let result = unsafe {
        ffi::lib_dspeak_media_consumer_set_jitter_buffer(consumer, min_delay, target_delay)
    };
    if result == 0 {
        Ok(Value::Null)
    } else {
        Err(json!("native consumer jitter buffer configuration failed"))
    }
}

fn append_video_stream_diagnostics(
    value: &Value,
    direction: &str,
    owner: &str,
    output: &mut Vec<Value>,
) {
    match value {
        Value::Array(values) => {
            for value in values {
                append_video_stream_diagnostics(value, direction, owner, output);
            }
        }
        Value::Object(values) => {
            let kind = values
                .get("kind")
                .or_else(|| values.get("mediaType"))
                .and_then(Value::as_str);
            if values.get("type").and_then(Value::as_str) == Some(direction)
                && kind == Some("video")
            {
                let field = |name: &str| values.get(name).cloned().unwrap_or(Value::Null);
                output.push(json!({
                    "owner": owner,
                    "direction": direction,
                    "id": field("id"),
                    "codecId": field("codecId"),
                    "frameWidth": field("frameWidth"),
                    "frameHeight": field("frameHeight"),
                    "framesPerSecond": field("framesPerSecond"),
                    "framesEncoded": field("framesEncoded"),
                    "framesDecoded": field("framesDecoded"),
                    "framesDropped": field("framesDropped"),
                    "totalEncodeTime": field("totalEncodeTime"),
                    "totalDecodeTime": field("totalDecodeTime"),
                    "encoderImplementation": field("encoderImplementation"),
                    "decoderImplementation": field("decoderImplementation"),
                    "qualityLimitationReason": field("qualityLimitationReason"),
                    "powerEfficientEncoder": field("powerEfficientEncoder"),
                    "powerEfficientDecoder": field("powerEfficientDecoder"),
                }));
            }
            for value in values.values() {
                append_video_stream_diagnostics(value, direction, owner, output);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

fn get_stats(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    let sampled_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| json!(error.to_string()))?
        .as_millis();
    let mut transports = Vec::new();
    if !state.send_transport.is_null() {
        let stats = unsafe { ffi::lib_dspeak_media_send_transport_get_stats(state.send_transport) };
        transports.push(json!({
            "id": "send",
            "kind": "send",
            "stats": native_json_string(stats, "native send transport stats")?,
        }));
    }
    if !state.recv_transport.is_null() {
        let stats = unsafe { ffi::lib_dspeak_media_recv_transport_get_stats(state.recv_transport) };
        transports.push(json!({
            "id": "recv",
            "kind": "recv",
            "stats": native_json_string(stats, "native recv transport stats")?,
        }));
    }
    let mut producers = Vec::new();
    let mut video_streams = Vec::new();
    for (source, producer) in &state.producers {
        let id = native_text(
            unsafe { ffi::lib_dspeak_media_producer_get_id(*producer) },
            "producer id",
        )?;
        let stats = unsafe { ffi::lib_dspeak_media_producer_get_stats(*producer) };
        let stats = native_json_string(stats, "native producer stats")?;
        append_video_stream_diagnostics(&stats, "outbound-rtp", &id, &mut video_streams);
        producers.push(json!({
            "id": id,
            "source": source,
            "stats": stats,
        }));
    }
    let mut consumers = Vec::new();
    for consumer in &state.consumers {
        let metadata = consumer_metadata(*consumer)?;
        let stats = unsafe { ffi::lib_dspeak_media_consumer_get_stats(*consumer) };
        let stats = native_json_string(stats, "native consumer stats")?;
        append_video_stream_diagnostics(&stats, "inbound-rtp", &metadata.0, &mut video_streams);
        consumers.push(json!({
            "id": metadata.0,
            "producerId": metadata.1,
            "kind": metadata.2,
            "stats": stats,
        }));
    }
    let capabilities = capabilities()?;
    Ok(json!({
        "engine": "native",
        "topology": "sfu",
        "sampledAt": sampled_at,
        "transports": transports,
        "producers": producers,
        "consumers": consumers,
        "videoStreams": video_streams,
        "videoCodecDiagnostics": capabilities.get("videoCodecDiagnostics").cloned().unwrap_or(Value::Null),
        "videoCodecCapabilities": capabilities.get("videoCodecCapabilities").cloned().unwrap_or(Value::Null),
        "concurrentEncode": capabilities.get("concurrentEncode").cloned().unwrap_or(Value::Null),
    }))
}

fn validate_capture_request(request: &Value, operation: &str, required_mode: &str) -> WorkerResult {
    let selection = request.get("captureSelection").ok_or_else(|| {
        capture_error(
            "DESKTOP_CAPTURE_INVALID_REQUEST",
            operation,
            "A validated desktop capture selection is required",
        )
    })?;
    let source_id = selection
        .get("sourceId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let source_type = selection
        .get("sourceType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let source_key = selection
        .get("sourceKey")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mode = selection
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mode_valid = mode == required_mode || required_mode == "video" && mode == "both";
    if source_id.is_empty()
        || source_type.is_empty()
        || source_key != format!("{source_type}:{source_id}")
        || !mode_valid
        || selection.get("excludeSelf") != Some(&Value::Bool(true))
        || selection.get("excludeSelfAudio") != Some(&Value::Bool(true))
    {
        return Err(capture_error(
            "DESKTOP_CAPTURE_INVALID_REQUEST",
            operation,
            "The native capture source identity, mode, and exclusion policy are invalid",
        ));
    }
    let audio = selection.get("audio").ok_or_else(|| {
        capture_error(
            "DESKTOP_CAPTURE_INVALID_REQUEST",
            operation,
            "Stereo 48 kHz audio policy is required",
        )
    })?;
    if audio.get("excludeSelfAudio") != Some(&Value::Bool(true))
        || audio.get("channels") != Some(&Value::Number(2.into()))
        || audio.get("sampleRate") != Some(&Value::Number(48000.into()))
        || audio.get("stereo") != Some(&Value::Bool(true))
    {
        return Err(capture_error(
            "DESKTOP_CAPTURE_INVALID_REQUEST",
            operation,
            "Desktop audio must be stereo at 48 kHz",
        ));
    }
    Ok(Value::Null)
}

fn capture_error(code: &str, operation: &str, message: &str) -> Value {
    json!({
        "code": code,
        "operation": operation,
        "message": message,
        "fallback": true,
    })
}

fn capture_native_error(code: &str, operation: &str, error_code: i32) -> Value {
    let detail = unsafe { ffi::lib_dspeak_media_capture_error_message(error_code) };
    let message = if detail.is_null() {
        "native capture failed".to_string()
    } else {
        unsafe { CStr::from_ptr(detail) }
            .to_string_lossy()
            .into_owned()
    };
    let mut error = capture_error(code, operation, &message);
    if let Some(object) = error.as_object_mut() {
        object.insert(
            "details".to_string(),
            json!({ "nativeErrorCode": error_code }),
        );
    }
    error
}

fn c_payload_string(payload: &Value, name: &str) -> Result<String, Value> {
    payload_string(payload, name)
}

fn payload_string(payload: &Value, name: &str) -> Result<String, Value> {
    payload
        .get(name)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            json!(format!(
                "native media worker payload field '{name}' is required"
            ))
        })
}

fn payload_u64(payload: &Value, name: &str) -> Result<u64, Value> {
    payload.get(name).and_then(Value::as_u64).ok_or_else(|| {
        json!(format!(
            "native media worker payload field '{name}' is required"
        ))
    })
}

fn payload_i32(payload: &Value, name: &str) -> Result<i32, Value> {
    payload
        .get(name)
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| {
            json!(format!(
                "native media worker payload field '{name}' is required"
            ))
        })
}

fn payload_number(payload: &Value, name: &str) -> Result<f64, Value> {
    payload.get(name).and_then(Value::as_f64).ok_or_else(|| {
        json!(format!(
            "native media worker payload field '{name}' is required"
        ))
    })
}

fn payload_bool(payload: &Value, name: &str) -> Result<bool, Value> {
    payload.get(name).and_then(Value::as_bool).ok_or_else(|| {
        json!(format!(
            "native media worker payload field '{name}' is required"
        ))
    })
}

fn native_text(pointer: *mut std::ffi::c_char, label: &str) -> Result<String, Value> {
    if pointer.is_null() {
        return Err(json!(format!("native {label} is unavailable")));
    }
    let value = unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| json!(format!("native {label} is not UTF-8")));
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    value
}

fn native_json_string(pointer: *mut std::ffi::c_char, label: &str) -> WorkerResult {
    let value = native_text(pointer, label)?;
    serde_json::from_str(&value)
        .map_err(|error| json!(format!("native {label} JSON was invalid: {error}")))
}

fn write_message(
    output: &Arc<Mutex<BufWriter<io::Stdout>>>,
    message: &Value,
) -> Result<(), String> {
    let mut output = output
        .lock()
        .map_err(|_| "native media worker output lock poisoned".to_string())?;
    serde_json::to_writer(&mut *output, message)
        .map_err(|error| format!("native media worker response encoding failed: {error}"))?;
    output
        .write_all(b"\n")
        .map_err(|error| format!("native media worker response write failed: {error}"))?;
    output
        .flush()
        .map_err(|error| format!("native media worker response flush failed: {error}"))
}

fn write_event_message(
    output: &Arc<Mutex<BufWriter<io::Stderr>>>,
    message: &Value,
) -> Result<(), String> {
    let mut output = output
        .lock()
        .map_err(|_| "native media worker event output lock poisoned".to_string())?;
    output
        .write_all(NATIVE_EVENT_PREFIX)
        .map_err(|error| format!("native media worker event prefix write failed: {error}"))?;
    serde_json::to_writer(&mut *output, message)
        .map_err(|error| format!("native media worker event encoding failed: {error}"))?;
    output
        .write_all(b"\n")
        .map_err(|error| format!("native media worker event write failed: {error}"))?;
    output
        .flush()
        .map_err(|error| format!("native media worker event flush failed: {error}"))
}

const MAX_NATIVE_VIDEO_FRAME_BYTES: usize = 600_000;
const NATIVE_VIDEO_FRAME_EVENT_KIND: i32 = 2;
const NATIVE_LOCAL_VIDEO_FRAME_EVENT_KIND: i32 = 5;

fn is_video_frame_event(kind: i32) -> bool {
    matches!(
        kind,
        NATIVE_VIDEO_FRAME_EVENT_KIND | NATIVE_LOCAL_VIDEO_FRAME_EVENT_KIND
    )
}

fn drain_events(output: &Arc<Mutex<BufWriter<io::Stderr>>>) {
    loop {
        let action = unsafe { ffi::lib_dspeak_media_drain_action() };
        let params_json = optional_native_text(action.params_json);
        let state = optional_native_text(action.state);
        if action.kind == 0 && params_json.is_none() && state.is_none() {
            break;
        }
        let _ = write_event_message(
            output,
            &json!({
                "type": "event",
                "event": "native-action",
                "payload": {
                    "kind": action.kind,
                    "transportPtr": action.transport_ptr as u64,
                    "actionId": action.action_id,
                    "paramsJson": params_json,
                    "state": state,
                },
            }),
        );
    }
    loop {
        let mut event = unsafe { ffi::lib_dspeak_media_drain_receive_event() };
        if event.kind == 0 {
            break;
        }
        let id = borrowed_native_text(event.id);
        let payload = borrowed_native_json(event.payload_json);
        let data_bytes = event.data_len as usize;
        let data_dropped =
            is_video_frame_event(event.kind) && data_bytes > MAX_NATIVE_VIDEO_FRAME_BYTES;
        let data = if data_dropped {
            None
        } else {
            borrowed_native_bytes(event.data, event.data_len)
        };
        let _ = write_event_message(
            output,
            &json!({
                "type": "event",
                "event": "native-receive-event",
                "payload": {
                    "kind": event.kind,
                    "eventId": event.event_id,
                    "id": id,
                    "payload": payload,
                    "data": data,
                    "dataBytes": data_bytes,
                    "dataDropped": data_dropped,
                },
            }),
        );
        unsafe { ffi::lib_dspeak_media_free_receive_event(&mut event) };
    }
}

fn optional_native_text(pointer: *mut std::ffi::c_char) -> Option<String> {
    if pointer.is_null() {
        return None;
    }
    let value = unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { ffi::lib_dspeak_media_free_string(pointer) };
    Some(value)
}

fn borrowed_native_text(pointer: *mut std::ffi::c_char) -> Option<String> {
    if pointer.is_null() {
        return None;
    }
    Some(
        unsafe { CStr::from_ptr(pointer) }
            .to_string_lossy()
            .into_owned(),
    )
}

fn borrowed_native_json(pointer: *mut std::ffi::c_char) -> Value {
    borrowed_native_text(pointer)
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_else(|| json!({}))
}

fn borrowed_native_bytes(pointer: *mut u8, length: u32) -> Option<String> {
    if pointer.is_null() || length == 0 {
        return None;
    }
    let bytes = unsafe { slice::from_raw_parts(pointer, length as usize) };
    Some(STANDARD.encode(bytes))
}
