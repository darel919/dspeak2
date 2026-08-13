use super::state::{
    BackgroundNotificationSession, BackgroundNotificationState, NotificationSyncResponse,
};
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};
use tauri_plugin_notification::NotificationExt;
use tokio::time::{sleep, Duration};

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

pub(crate) async fn run_background_notification_poller(
    app: AppHandle,
    state: BackgroundNotificationState,
) {
    let mut client = None;
    loop {
        let wake = state.wake.clone();
        let notification = wake.notified();
        let session = state.session.lock().ok().and_then(|value| value.clone());
        if let Some(session) = session {
            let request_client = client.get_or_insert_with(reqwest::Client::new);
            if let Ok(response) = fetch_background_notifications(request_client, &session).await {
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
                                {
                                    pending.push((item.title, item.body));
                                }
                            }
                            current.cursor = newest;
                            current.baseline_complete = true;
                        }
                    }
                }
                for (title, body) in pending {
                    let _ = app
                        .notification()
                        .builder()
                        .title(if title.is_empty() {
                            "dSpeak Notification"
                        } else {
                            &title
                        })
                        .body(&body)
                        .show();
                }
            }
            tokio::select! {
                _ = sleep(Duration::from_secs(30)) => {}
                _ = notification => {}
            }
        } else {
            client = None;
            notification.await;
        }
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
pub async fn show_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|error| error.to_string())
}
