use super::state::{
    BackgroundNotificationSession, BackgroundNotificationState, NativeNotification,
    NotificationNavigationTarget, NotificationSyncResponse,
};
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::time::{sleep, Duration};

const POLL_INTERVAL_SECS: u64 = 60;
const POLL_MAX_BACKOFF_SECS: u64 = 15 * 60;
const MAIN_WINDOW_LABEL: &str = "main";

#[tauri::command]
pub async fn register_background_notifications(
    state: State<'_, BackgroundNotificationState>,
    server_url: String,
    token: String,
) -> Result<(), String> {
    let normalized_url = server_url.trim_end_matches('/');
    if !(normalized_url.starts_with("https://") || normalized_url.starts_with("http://")) {
        return Err("Notification server URL must use HTTP or HTTPS".to_string());
    }
    if token.is_empty() {
        return Err("Notification session token is required".to_string());
    }
    *state
        .session
        .lock()
        .map_err(|_| "Notification state is unavailable")? = Some(BackgroundNotificationSession {
        server_url: normalized_url.to_string(),
        token,
        baseline_complete: false,
        cursor: None,
        seen_ids: HashSet::new(),
    });
    state.wake.notify_one();
    Ok(())
}

#[tauri::command]
pub async fn clear_background_notifications(
    state: State<'_, BackgroundNotificationState>,
) -> Result<(), String> {
    *state
        .session
        .lock()
        .map_err(|_| "Notification state is unavailable")? = None;
    state.wake.notify_one();
    Ok(())
}

#[tauri::command]
pub async fn set_background_notifications_enabled(
    state: State<'_, BackgroundNotificationState>,
    enabled: bool,
) -> Result<(), String> {
    state.enabled.store(enabled, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn take_pending_notification_navigation(
    state: State<'_, BackgroundNotificationState>,
) -> Result<Option<NotificationNavigationTarget>, String> {
    let mut pending = state
        .pending_navigation
        .lock()
        .map_err(|_| "Notification state is unavailable".to_string())?;
    Ok(pending.take())
}

pub(crate) async fn run_background_notification_poller(
    app: AppHandle,
    state: BackgroundNotificationState,
) {
    let mut client = None;
    let mut backoff_secs = POLL_INTERVAL_SECS;
    loop {
        let wake = state.wake.clone();
        let notification = wake.notified();
        let session = state.session.lock().ok().and_then(|value| value.clone());
        if let Some(session) = session {
            let request_client = client.get_or_insert_with(reqwest::Client::new);
            match fetch_background_notifications(request_client, &session).await {
                Ok(response) => {
                    backoff_secs = POLL_INTERVAL_SECS;
                    let mut pending = Vec::new();
                    if let Ok(mut current) = state.session.lock() {
                        if let Some(current) = current.as_mut() {
                            if current.server_url == session.server_url
                                && current.token == session.token
                            {
                                let mut newest = current.cursor.clone();
                                for item in response.items {
                                    if newest.as_ref().is_none_or(|value| item.created > *value) {
                                        newest = Some(item.created.clone());
                                    }
                                    if current.seen_ids.insert(item.id.clone())
                                        && current.baseline_complete
                                        && state.enabled.load(Ordering::Relaxed)
                                        && !webview_alive(&app)
                                    {
                                        pending.push(item);
                                    }
                                }
                                current.cursor = newest;
                                current.baseline_complete = true;
                            }
                        }
                    }
                    for item in pending {
                        crate::desktop::activity_log::log_activity(
                            &app,
                            crate::desktop::activity_log::LogCategory::Notifications,
                            crate::desktop::activity_log::ActivityLevel::Debug,
                            "notification-shown",
                            serde_json::json!({
                                "id": item.id,
                                "title": item.title,
                            }),
                        );
                        show_clickable_notification(&app, &state, &item);
                    }
                }
                Err(error) => {
                    eprintln!("[dspeak] background notification sync failed: {error}");
                    crate::desktop::activity_log::log_activity(
                        &app,
                        crate::desktop::activity_log::LogCategory::Notifications,
                        crate::desktop::activity_log::ActivityLevel::Warning,
                        "notification-sync-failed",
                        serde_json::json!({ "error": error }),
                    );
                    backoff_secs = (backoff_secs.saturating_mul(2)).min(POLL_MAX_BACKOFF_SECS);
                }
            }
            let jitter_millis = (SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map_or(0, |value| value.subsec_millis() as u64)
                % 1000)
                * 1000;
            let wait = Duration::from_secs(backoff_secs) + Duration::from_millis(jitter_millis);
            tokio::select! {
                _ = sleep(wait) => {}
                _ = notification => {}
            }
        } else {
            client = None;
            backoff_secs = POLL_INTERVAL_SECS;
            notification.await;
        }
    }
}

fn webview_alive(app: &AppHandle) -> bool {
    app.get_webview_window(MAIN_WINDOW_LABEL).is_some()
}

fn show_clickable_notification(
    app: &AppHandle,
    state: &BackgroundNotificationState,
    item: &NativeNotification,
) {
    let target = item.navigation_target();
    let title = if item.title.is_empty() {
        "dSpeak Notification".to_string()
    } else {
        item.title.clone()
    };
    let body = item.body.clone();
    let app_handle = app.clone();
    let pending_state = state.clone();
    std::thread::spawn(move || {
        let mut notification = notify_rust::Notification::new();
        notification.summary(&title).body(&body);
        let _ = notification.show().map(|handle| {
            handle.wait_for_action(move |action| {
                if action != "default" || target.is_none() {
                    return;
                }
                queue_and_reveal(
                    &app_handle,
                    &pending_state,
                    target.expect("target presence checked above"),
                );
            })
        });
    });
}

fn queue_and_reveal(
    app: &AppHandle,
    state: &BackgroundNotificationState,
    target: NotificationNavigationTarget,
) {
    if let Ok(mut pending) = state.pending_navigation.lock() {
        *pending = Some(target);
    }
    if let Err(error) = super::window::open_main_window(app) {
        eprintln!("[dspeak] failed to open main window from notification: {error}");
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.emit("notification:navigate", ());
    }
}

async fn fetch_background_notifications(
    client: &reqwest::Client,
    session: &BackgroundNotificationSession,
) -> Result<NotificationSyncResponse, String> {
    let mut request = client
        .get(format!("{}/api/notifications/sync", session.server_url))
        .bearer_auth(&session.token);
    if let Some(cursor) = &session.cursor {
        request = request.query(&[("since", cursor)]);
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Notification sync failed: {}", response.status()));
    }
    response
        .json::<NotificationSyncResponse>()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn show_notification(title: String, body: String) -> Result<(), String> {
    std::thread::spawn(move || {
        let mut notification = notify_rust::Notification::new();
        notification.summary(&title).body(&body);
        if let Err(error) = notification.show() {
            eprintln!("[dspeak] notification display failed: {error}");
        }
    });
    Ok(())
}
