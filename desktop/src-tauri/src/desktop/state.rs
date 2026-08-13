use std::collections::HashSet;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::Mutex;
use tokio::sync::Notify;

#[derive(Clone)]
pub(crate) struct OAuthState {
    pub(crate) callback_url: std::sync::Arc<Mutex<Option<String>>>,
    pub(crate) pending_callback: std::sync::Arc<Mutex<Option<OAuthCallback>>>,
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct OAuthCallback {
    pub(crate) code: String,
    pub(crate) state: String,
}

#[derive(Clone)]
pub(crate) struct OAuthServerState {
    pub(crate) app: tauri::AppHandle,
    pub(crate) oauth: OAuthState,
}

#[derive(Clone)]
pub(crate) struct BackgroundNotificationState {
    pub(crate) session: Arc<Mutex<Option<BackgroundNotificationSession>>>,
    pub(crate) enabled: Arc<AtomicBool>,
    pub(crate) wake: Arc<Notify>,
}

#[derive(Clone)]
pub(crate) struct BackgroundNotificationSession {
    pub(crate) server_url: String,
    pub(crate) token: String,
    pub(crate) baseline_complete: bool,
    pub(crate) cursor: Option<String>,
    pub(crate) seen_ids: HashSet<String>,
}

#[derive(serde::Deserialize)]
pub(crate) struct NotificationSyncResponse {
    pub(crate) items: Vec<NativeNotification>,
}

#[derive(serde::Deserialize)]
pub(crate) struct NativeNotification {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) body: String,
    pub(crate) created: String,
}

pub(crate) static HIDE_ON_CLOSE: AtomicBool = AtomicBool::new(true);
