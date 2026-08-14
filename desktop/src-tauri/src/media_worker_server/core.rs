use super::capture::{capture_devices, capture_sources};
use super::sfu::capabilities;
use super::state::WorkerState;
use super::{DispatchResult, WorkerResult};
use serde_json::{json, Value};
use std::io::{self, BufWriter};
use std::sync::{Arc, Mutex};

pub(super) fn ready(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized().map(|_| Value::Null)
}

pub(super) fn initialize(
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

pub(super) fn join(
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

pub(super) fn leave(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    state.clear_p2p();
    state.clear_transports();
    state.stop_captures();
    state.connected = false;
    state.session = None;
    state_value(state)
}

pub(super) fn close_sfu(state: &mut WorkerState) -> WorkerResult {
    state.ensure_initialized()?;
    state.clear_transports();
    Ok(Value::Null)
}

pub(super) fn state_value(state: &mut WorkerState) -> WorkerResult {
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

pub(super) fn set_topology(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    state.topology = payload.get("topology").cloned();
    Ok(json!({ "topology": state.topology }))
}

pub(super) fn set_ice_servers(state: &mut WorkerState, payload: Value) -> WorkerResult {
    state.ensure_initialized()?;
    state.ice_servers = payload
        .get("iceServers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(json!({ "iceServers": state.ice_servers }))
}

pub(super) fn prepare_devices(state: &mut WorkerState) -> DispatchResult {
    let result = state
        .ensure_initialized()
        .and_then(|_| capture_devices())
        .map(|devices| devices);
    DispatchResult {
        result,
        shutdown_after: false,
    }
}

pub(super) fn prepare_capture(state: &mut WorkerState) -> DispatchResult {
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
