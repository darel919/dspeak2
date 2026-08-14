use serde_json::Value;

pub(super) type WorkerResult = Result<Value, Value>;

pub(super) use super::state::NativeMediaStore;
pub(super) use super::types::NativeMediaState;
pub(super) use super::{MEDIA_EVENT_NATIVE_ACTION, MEDIA_EVENT_NATIVE_RECEIVE, MEDIA_EVENT_STATE};

mod client;
mod connection;
mod diagnostics;
mod process;
mod routing;

pub(crate) use client::MediaWorkerClient;
pub(crate) use routing::media_worker_invoke;

mod tests {
    use super::client::MediaWorkerClient;
    use super::diagnostics::{
        exit_status_diagnostics, worker_connection_can_be_replaced, worker_exit_is_unexpected,
        worker_exited_error_payload,
    };
    use serde_json::{json, Value};
    #[cfg(unix)]
    use std::os::unix::process::ExitStatusExt;
    use std::process::ExitStatus;
    use std::sync::atomic::Ordering;

    #[test]
    fn requested_shutdown_is_not_unexpected_worker_exit() {
        assert!(!worker_exit_is_unexpected(true, false));
    }

    #[test]
    fn unexpected_worker_exit_is_detected_without_shutdown_request() {
        assert!(worker_exit_is_unexpected(false, false));
    }

    #[test]
    fn forced_worker_termination_is_always_unexpected() {
        assert!(worker_exit_is_unexpected(true, true));
    }

    #[test]
    fn only_a_requested_non_forced_stop_allows_replacement() {
        assert!(worker_connection_can_be_replaced(true, false));
        assert!(!worker_connection_can_be_replaced(false, false));
        assert!(!worker_connection_can_be_replaced(true, true));
    }

    #[test]
    fn worker_client_crash_latch_returns_structured_fatal_error() {
        let client = MediaWorkerClient::default();
        assert!(!client.is_crashed());
        client.crashed.store(true, Ordering::Release);
        let error = client.crashed_error();
        assert_eq!(
            error.get("code").and_then(Value::as_str),
            Some("MEDIA_WORKER_EXITED")
        );
        assert_eq!(error.get("recoverable"), Some(&Value::Bool(false)));
    }

    #[test]
    fn unexpected_exit_builds_structured_error_with_diagnostics() {
        let error = worker_exited_error_payload(
            json!({
                "exitStatus": "signal: 6",
                "exitCode": null,
                "signal": 6,
                "coreDumped": false,
            }),
            json!({
                "lastCommand": "media_set_camera",
                "lastRequestId": 8,
                "lastCommandStartedAt": 123,
                "recentCommands": [],
            }),
            vec!["camera assertion failed".to_string()],
        );
        assert_eq!(
            error.get("code").and_then(Value::as_str),
            Some("MEDIA_WORKER_EXITED")
        );
        assert_eq!(error.get("signal"), Some(&json!(6)));
        assert_eq!(error.get("lastCommand"), Some(&json!("media_set_camera")));
        assert_eq!(
            error
                .get("diagnostics")
                .and_then(|value| value.get("stderrTail"))
                .and_then(Value::as_array)
                .and_then(|values| values.first()),
            Some(&json!("camera assertion failed")),
        );
    }

    #[test]
    fn missing_exit_status_keeps_optional_diagnostics_empty() {
        let diagnostics = exit_status_diagnostics(None);
        assert_eq!(diagnostics.get("exitStatus"), Some(&Value::Null));
        assert_eq!(diagnostics.get("exitCode"), Some(&Value::Null));
        #[cfg(unix)]
        {
            assert_eq!(diagnostics.get("signal"), Some(&Value::Null));
            assert_eq!(diagnostics.get("coreDumped"), Some(&Value::Bool(false)));
        }
    }

    #[cfg(unix)]
    #[test]
    fn unix_signal_termination_is_decoded() {
        let status = ExitStatus::from_raw(6);
        let diagnostics = exit_status_diagnostics(Some(&status));
        assert_eq!(diagnostics.get("exitCode"), Some(&Value::Null));
        assert_eq!(diagnostics.get("signal"), Some(&json!(6)));
    }
}
