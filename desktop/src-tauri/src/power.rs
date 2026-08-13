use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};

struct StayAwakeWorker {
    release: Sender<()>,
    join: Option<JoinHandle<()>>,
}

pub(crate) struct StayAwake {
    worker: Mutex<Option<StayAwakeWorker>>,
}

impl Default for StayAwake {
    fn default() -> Self {
        Self {
            worker: Mutex::new(None),
        }
    }
}

impl StayAwake {
    pub(crate) fn acquire(&self) {
        let Ok(mut worker) = self.worker.lock() else {
            eprintln!("[dspeak:power] stay-awake state lock is poisoned");
            return;
        };
        if worker.is_some() {
            return;
        }

        let (release, receiver) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("dspeak-stay-awake".to_string())
            .spawn(move || platform::run(receiver));
        match thread {
            Ok(join) => {
                *worker = Some(StayAwakeWorker {
                    release,
                    join: Some(join),
                });
            }
            Err(error) => {
                eprintln!("[dspeak:power] could not start stay-awake worker: {error}");
            }
        }
    }

    pub(crate) fn release(&self) {
        let worker = self.worker.lock().ok().and_then(|mut value| value.take());
        let Some(mut worker) = worker else {
            return;
        };
        let _ = worker.release.send(());
        if let Some(join) = worker.join.take() {
            let _ = join.join();
        }
    }
}

impl Drop for StayAwake {
    fn drop(&mut self) {
        let worker = self.worker.get_mut().ok().and_then(Option::take);
        let Some(mut worker) = worker else {
            return;
        };
        let _ = worker.release.send(());
        if let Some(join) = worker.join.take() {
            let _ = join.join();
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::Receiver;

    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetThreadExecutionState(es_flags: u32) -> u32;
    }

    pub(super) fn run(receiver: Receiver<()>) {
        let active = unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) != 0 };
        if !active {
            eprintln!("[dspeak:power] Windows stay-awake request failed");
        }
        let _ = receiver.recv();
        if active {
            unsafe {
                SetThreadExecutionState(ES_CONTINUOUS);
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::Receiver;
    use std::ffi::c_void;
    use std::os::raw::c_char;

    type CFStringRef = *const c_void;
    type IOPMAssertionId = u32;

    const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const IOPM_ASSERTION_LEVEL_ON: u32 = 255;

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(value: *const c_void);
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            value: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
    }

    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        fn IOPMAssertionCreateWithName(
            assertion_type: CFStringRef,
            assertion_level: u32,
            assertion_name: CFStringRef,
            assertion_id: *mut IOPMAssertionId,
        ) -> i32;
        fn IOPMAssertionRelease(assertion_id: IOPMAssertionId) -> i32;
    }

    fn create_string(value: &'static [u8]) -> CFStringRef {
        unsafe {
            CFStringCreateWithCString(
                std::ptr::null(),
                value.as_ptr().cast(),
                CF_STRING_ENCODING_UTF8,
            )
        }
    }

    pub(super) fn run(receiver: Receiver<()>) {
        let assertion_type = create_string(b"PreventUserIdleSystemSleep\0");
        let assertion_name = create_string(b"dSpeak voice channel\0");
        if assertion_type.is_null() || assertion_name.is_null() {
            if !assertion_type.is_null() {
                unsafe { CFRelease(assertion_type) };
            }
            if !assertion_name.is_null() {
                unsafe { CFRelease(assertion_name) };
            }
            eprintln!("[dspeak:power] macOS stay-awake assertion could not be created");
            return;
        }

        let mut assertion_id = 0;
        let result = unsafe {
            IOPMAssertionCreateWithName(
                assertion_type,
                IOPM_ASSERTION_LEVEL_ON,
                assertion_name,
                &mut assertion_id,
            )
        };
        unsafe {
            CFRelease(assertion_type);
            CFRelease(assertion_name);
        }
        if result != 0 {
            eprintln!("[dspeak:power] macOS stay-awake assertion failed with code {result}");
            return;
        }

        let _ = receiver.recv();
        unsafe {
            IOPMAssertionRelease(assertion_id);
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::Receiver;

    pub(super) fn run(receiver: Receiver<()>) {
        let _ = receiver.recv();
    }
}

#[cfg(test)]
mod tests {
    use super::StayAwake;

    #[test]
    fn stay_awake_is_idempotent_and_releasable() {
        let controller = StayAwake::default();
        controller.acquire();
        controller.acquire();
        controller.release();
        controller.release();
    }
}
