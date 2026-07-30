#[cfg(native_rtc)]
use super::ffi;
use super::types::NativeMediaState;
use super::MEDIA_EVENT_STATE;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[cfg(native_rtc)]
pub(crate) struct NativeHandleRegistry {
    pub(crate) device: *mut ffi::lib_dspeak_media_device_t,
    pub(crate) send_transport: *mut ffi::lib_dspeak_media_send_transport_t,
    pub(crate) recv_transport: *mut ffi::lib_dspeak_media_recv_transport_t,
    pub(crate) audio_producer: *mut ffi::lib_dspeak_media_producer_t,
    pub(crate) video_producer: *mut ffi::lib_dspeak_media_producer_t,
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
            audio_producer: std::ptr::null_mut(),
            video_producer: std::ptr::null_mut(),
        }
    }
}

#[cfg(native_rtc)]
impl NativeHandleRegistry {
    pub(crate) fn clear_transports(&mut self) {
        unsafe {
            if !self.audio_producer.is_null() {
                ffi::lib_dspeak_media_destroy_producer(self.audio_producer);
                self.audio_producer = std::ptr::null_mut();
            }
            if !self.video_producer.is_null() {
                ffi::lib_dspeak_media_destroy_producer(self.video_producer);
                self.video_producer = std::ptr::null_mut();
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
