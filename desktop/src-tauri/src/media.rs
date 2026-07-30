//! Native media state, startup validation, and Tauri command façade.

mod commands;
#[cfg(native_rtc)]
mod ffi;
#[cfg(native_rtc)]
mod native;
mod startup;
mod state;
mod types;

pub const MEDIA_EVENT_STATE: &str = "media:state";

pub use commands::*;
pub use startup::strict_startup_check;
pub use state::NativeMediaStore;
