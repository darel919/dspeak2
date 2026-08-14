use super::command::dispatch;
use super::protocol::write_message;
use super::state::WorkerState;
use serde_json::{json, Value};
use std::io::{self, BufRead, BufReader, BufWriter};
use std::sync::{Arc, Mutex};
use std::thread;

pub(super) fn run() -> Result<(), String> {
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
