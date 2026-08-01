#[cfg(native_rtc)]
use super::ffi;
use super::types::NativeMediaState;
use super::MEDIA_EVENT_STATE;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[cfg(native_rtc)]
pub(crate) struct NativeHandleRegistry {
    pub(crate) device: *mut ffi::lib_dspeak_media_device_t,
    pub(crate) send_transport: *mut ffi::lib_dspeak_media_send_transport_t,
    pub(crate) recv_transport: *mut ffi::lib_dspeak_media_recv_transport_t,
    pub(crate) producers: BTreeMap<String, *mut ffi::lib_dspeak_media_producer_t>,
    pub(crate) consumers: Vec<*mut ffi::lib_dspeak_media_consumer_t>,
    pub(crate) p2p_handles: BTreeMap<u64, *mut ffi::lib_dspeak_media_p2p_handle_t>,
    pub(crate) p2p_tracks: BTreeMap<(u64, String), (String, *mut std::ffi::c_void)>,
}

#[cfg(native_rtc)]
unsafe impl Send for NativeHandleRegistry {}

#[cfg(native_rtc)]
impl Default for NativeHandleRegistry {
    fn default() -> Self {
        Self {
            device: std::ptr::null_mut(),
            send_transport: std::ptr::null_mut(),
            recv_transport: std::ptr::null_mut(),
            producers: BTreeMap::new(),
            consumers: Vec::new(),
            p2p_handles: BTreeMap::new(),
            p2p_tracks: BTreeMap::new(),
        }
    }
}

#[cfg(native_rtc)]
impl NativeHandleRegistry {
    pub(crate) fn clear_p2p(&mut self) {
        unsafe {
            for (_, handle) in std::mem::take(&mut self.p2p_handles) {
                if !handle.is_null() {
                    ffi::lib_dspeak_media_p2p_destroy(handle);
                }
            }
        }
        self.p2p_tracks.clear();
    }

    pub(crate) fn clear_transports(&mut self) {
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
                self.recv_transport = std::ptr::null_mut();
            }
            if !self.send_transport.is_null() {
                ffi::lib_dspeak_media_destroy_send_transport(self.send_transport);
                self.send_transport = std::ptr::null_mut();
            }
        }
    }

    pub(crate) fn clear_all(&mut self) {
        self.clear_p2p();
        self.clear_transports();
        unsafe {
            if !self.device.is_null() {
                ffi::lib_dspeak_media_destroy_device(self.device);
                self.device = std::ptr::null_mut();
            }
        }
    }
}

#[cfg(native_rtc)]
impl Drop for NativeHandleRegistry {
    fn drop(&mut self) {
        self.clear_all();
    }
}

pub struct NativeMediaStore {
    pub(crate) state: Arc<Mutex<NativeMediaState>>,
    #[cfg(native_rtc)]
    pub(crate) handles: Arc<Mutex<NativeHandleRegistry>>,
}

impl Default for NativeMediaStore {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(NativeMediaState::default())),
            #[cfg(native_rtc)]
            handles: Arc::new(Mutex::new(NativeHandleRegistry::default())),
        }
    }
}

pub(crate) fn lock_state<'a>(
    store: &'a State<'_, NativeMediaStore>,
) -> Result<std::sync::MutexGuard<'a, NativeMediaState>, String> {
    store
        .state
        .lock()
        .map_err(|_| "native media state lock poisoned".to_string())
}

pub(crate) fn emit_state(app: &AppHandle, state: &NativeMediaState) {
    let _ = app.emit(MEDIA_EVENT_STATE, state);
}
