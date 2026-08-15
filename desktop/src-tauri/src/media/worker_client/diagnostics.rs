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

const MAX_NATIVE_BACKTRACE_LINES: usize = 64;

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
            "signalName": exit_status
                .and_then(ExitStatusExt::signal)
                .and_then(unix_signal_name),
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

#[cfg(unix)]
fn unix_signal_name(signal: i32) -> Option<&'static str> {
    match signal {
        1 => Some("SIGHUP"),
        2 => Some("SIGINT"),
        3 => Some("SIGQUIT"),
        4 => Some("SIGILL"),
        5 => Some("SIGTRAP"),
        6 => Some("SIGABRT"),
        7 => Some("SIGBUS"),
        8 => Some("SIGFPE"),
        9 => Some("SIGKILL"),
        10 => Some("SIGUSR1"),
        11 => Some("SIGSEGV"),
        12 => Some("SIGUSR2"),
        13 => Some("SIGPIPE"),
        14 => Some("SIGALRM"),
        15 => Some("SIGTERM"),
        17 => Some("SIGCHLD"),
        18 => Some("SIGCONT"),
        19 => Some("SIGSTOP"),
        20 => Some("SIGTSTP"),
        21 => Some("SIGTTIN"),
        22 => Some("SIGTTOU"),
        _ => None,
    }
}

pub(super) fn native_crash_diagnostics(stderr_tail: &[String]) -> Value {
    let mut signal = None;
    let mut address = None;
    let mut backtrace = Vec::new();
    let mut reading_backtrace = false;

    for line in stderr_tail {
        if let Some(value) = line.strip_prefix("[dspeak:crash] native media worker signal=") {
            let mut fields = value.split_whitespace();
            signal = fields.next().and_then(|value| value.parse::<i32>().ok());
            address = fields.find_map(|field| field.strip_prefix("address=").map(str::to_string));
            continue;
        }
        if line.trim() == "[dspeak:crash] native backtrace follows" {
            reading_backtrace = true;
            continue;
        }
        if reading_backtrace && backtrace.len() < MAX_NATIVE_BACKTRACE_LINES {
            backtrace.push(line.clone());
        }
    }

    let signal_name: Option<&'static str> = {
        #[cfg(unix)]
        {
            signal.and_then(unix_signal_name)
        }
        #[cfg(not(unix))]
        {
            None
        }
    };

    json!({
        "signal": signal,
        "signalName": signal_name,
        "address": address,
        "backtrace": backtrace,
    })
}

pub(super) fn worker_exited_error(
    connection: &WorkerConnection,
    exit_status: Option<&ExitStatus>,
) -> Value {
    worker_exited_error_payload(
        exit_status_diagnostics(exit_status),
        connection.command_diagnostics(),
        connection.stderr_diagnostics(),
        connection.native_crash_diagnostics(),
    )
}

pub(super) fn worker_exited_error_payload(
    status: Value,
    commands: Value,
    stderr_tail: Vec<String>,
    native_crash_lines: Vec<String>,
) -> Value {
    let native_crash = native_crash_diagnostics(&native_crash_lines);
    let exit_code = status.get("exitCode").and_then(Value::as_i64);
    let reported_signal = status.get("signal").and_then(Value::as_i64);
    let native_signal = native_crash.get("signal").and_then(Value::as_i64);
    let normalized_signal = match (reported_signal, exit_code, native_signal) {
        (None, Some(exit_code), Some(signal)) if exit_code == 128 + signal => Some(signal),
        _ => None,
    };
    let mut error = json!({
        "code": "MEDIA_WORKER_EXITED",
        "source": "native-media-worker",
        "message": "The native media worker exited unexpectedly",
        "recoverable": false,
        "diagnostics": {
            "commands": commands.clone(),
            "stderrTail": stderr_tail,
            "nativeCrash": native_crash,
        },
    });
    if let Value::Object(object) = &mut error {
        if let Value::Object(status_object) = status {
            object.extend(status_object);
        }
        if let Some(signal) = normalized_signal {
            object.insert("signal".to_string(), json!(signal));
            if let Some(signal_name) = native_crash.get("signalName") {
                object.insert("signalName".to_string(), signal_name.clone());
            }
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
