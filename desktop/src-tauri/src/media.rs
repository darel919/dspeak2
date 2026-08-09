//! Native media state, startup validation, and Tauri command façade.

mod command_capture;
mod command_consumers;
mod command_core;
mod command_p2p;
mod command_producers;
mod command_sfu;
mod command_signaling;
mod command_stats;
#[cfg(native_rtc)]
mod ffi;
#[cfg(native_rtc)]
mod native;
mod startup;
mod state;
mod types;

pub const MEDIA_EVENT_STATE: &str = "media:state";

pub use command_capture::*;
pub use command_consumers::*;
pub use command_core::*;
pub use command_p2p::*;
pub use command_producers::*;
pub use command_sfu::*;
pub use command_signaling::*;
pub use command_stats::*;
pub use startup::strict_startup_check;
pub use state::NativeMediaStore;
