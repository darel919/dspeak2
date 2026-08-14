use super::protocol::drain_events;
use super::WorkerResult;
use crate::ffi;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::ffi::c_void;
use std::io::{self, BufWriter};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

pub(super) struct EventPump {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

pub(super) struct WorkerState {
    pub(super) initialized: bool,
    pub(super) connected: bool,
    pub(super) session: Option<Value>,
    pub(super) topology: Option<Value>,
    pub(super) ice_servers: Vec<Value>,
    pub(super) device: *mut ffi::lib_dspeak_media_device_t,
    pub(super) send_transport: *mut ffi::lib_dspeak_media_send_transport_t,
    pub(super) recv_transport: *mut ffi::lib_dspeak_media_recv_transport_t,
    pub(super) producers: BTreeMap<String, *mut ffi::lib_dspeak_media_producer_t>,
    pub(super) consumers: Vec<*mut ffi::lib_dspeak_media_consumer_t>,
    pub(super) p2p_handles: HashMap<u64, *mut ffi::lib_dspeak_media_p2p_handle_t>,
    pub(super) p2p_tracks: HashMap<(u64, String), (String, *mut c_void)>,
    pub(super) next_handle: u64,
    pub(super) event_pump: Option<EventPump>,
}

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
    pub(super) fn ensure_initialized(&mut self) -> WorkerResult {
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

    pub(super) fn start_events(
        &mut self,
        output: Arc<Mutex<BufWriter<io::Stderr>>>,
    ) -> WorkerResult {
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

    pub(super) fn clear_transports(&mut self) {
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

    pub(super) fn clear_p2p(&mut self) {
        unsafe {
            for (_, handle) in std::mem::take(&mut self.p2p_handles) {
                if !handle.is_null() {
                    ffi::lib_dspeak_media_p2p_destroy(handle);
                }
            }
        }
        self.p2p_tracks.clear();
    }

    pub(super) fn stop_captures(&mut self) {
        unsafe {
            let mut error = 0;
            let _ = ffi::lib_dspeak_media_stop_capture(&mut error);
            ffi::lib_dspeak_media_stop_system_audio_capture();
            let _ = ffi::lib_dspeak_media_stop_microphone_capture(&mut error);
            let _ = ffi::lib_dspeak_media_stop_camera_capture(&mut error);
        }
    }

    pub(super) fn clear_all(&mut self) {
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

    pub(super) fn shutdown(&mut self) {
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

    pub(super) fn next_handle(&mut self) -> u64 {
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
