use super::connection::WorkerConnection;
use super::WorkerResult;
use serde_json::{json, Value};
use std::collections::HashMap;
#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;
use std::process::ExitStatus;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) fn worker_exit_is_unexpected(
    shutdown_requested: bool,
    forced_termination: bool,
) -> bool {
    !shutdown_requested || forced_termination
}

pub(super) fn worker_connection_can_be_replaced(
    shutdown_requested: bool,
    forced_termination: bool,
) -> bool {
    shutdown_requested && !forced_termination
}

pub(super) fn current_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

pub(super) fn exit_status_diagnostics(exit_status: Option<&ExitStatus>) -> Value {
    let exit_status_text = exit_status.map(|status| format!("{status:?}"));
    let exit_code = exit_status.and_then(ExitStatus::code);
    #[cfg(unix)]
    {
        return json!({
            "exitStatus": exit_status_text,
            "exitCode": exit_code,
            "signal": exit_status.and_then(ExitStatusExt::signal),
            "coreDumped": exit_status.is_some_and(ExitStatusExt::core_dumped),
        });
    }
    #[cfg(windows)]
    {
        return json!({
            "exitStatus": exit_status_text,
            "exitCode": exit_code,
        });
    }
    #[cfg(not(any(unix, windows)))]
    {
        json!({
            "exitStatus": exit_status_text,
            "exitCode": exit_code,
        })
    }
}

pub(super) fn worker_exited_error(
    connection: &WorkerConnection,
    exit_status: Option<&ExitStatus>,
) -> Value {
    worker_exited_error_payload(
        exit_status_diagnostics(exit_status),
        connection.command_diagnostics(),
        connection.stderr_diagnostics(),
    )
}

pub(super) fn worker_exited_error_payload(
    status: Value,
    commands: Value,
    stderr_tail: Vec<String>,
) -> Value {
    let mut error = json!({
        "code": "MEDIA_WORKER_EXITED",
        "source": "native-media-worker",
        "message": "The native media worker exited unexpectedly",
        "recoverable": false,
        "diagnostics": {
            "commands": commands.clone(),
            "stderrTail": stderr_tail,
        },
    });
    if let Value::Object(object) = &mut error {
        if let Value::Object(status_object) = status {
            object.extend(status_object);
        }
        if let Some(commands_object) = commands.as_object() {
            for key in [
                "lastCommand",
                "lastRequestId",
                "lastCommandStartedAt",
                "recentCommands",
            ] {
                object.insert(
                    key.to_string(),
                    commands_object.get(key).cloned().unwrap_or(Value::Null),
                );
            }
        }
    }
    error
}

pub(super) fn fail_pending(pending: &Arc<Mutex<HashMap<u64, Sender<WorkerResult>>>>, error: Value) {
    let requests = pending
        .lock()
        .ok()
        .map(|mut pending| {
            pending
                .drain()
                .map(|(_, sender)| sender)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for sender in requests {
        let _ = sender.send(Err(error.clone()));
    }
}
