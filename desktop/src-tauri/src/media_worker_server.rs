use serde_json::Value;

pub(crate) type WorkerResult = Result<Value, Value>;

pub(crate) struct DispatchResult {
    pub(crate) result: WorkerResult,
    pub(crate) shutdown_after: bool,
}

#[path = "media_worker_server/capture.rs"]
mod capture;
#[path = "media_worker_server/command.rs"]
mod command;
#[path = "media_worker_server/core.rs"]
mod core;
#[path = "media_worker_server/p2p.rs"]
mod p2p;
#[path = "media_worker_server/protocol.rs"]
mod protocol;
#[path = "media_worker_server/runtime.rs"]
mod runtime;
#[path = "media_worker_server/sfu.rs"]
mod sfu;
#[path = "media_worker_server/state.rs"]
mod state;

pub fn run() -> Result<(), String> {
    runtime::run()
}
