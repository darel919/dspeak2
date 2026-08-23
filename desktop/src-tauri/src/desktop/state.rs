use std::collections::HashSet;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::Mutex;
use tokio::sync::Notify;

#[derive(Clone)]
pub(crate) struct OAuthState {
    pub(crate) callback_url: std::sync::Arc<Mutex<Option<String>>>,
    pub(crate) pending_callback: std::sync::Arc<Mutex<Option<OAuthCallback>>>,
    pub(crate) ready: std::sync::Arc<tokio::sync::Notify>,
}

#[derive(Clone, serde::Serialize)]
pub(crate) struct OAuthCallback {
    pub(crate) code: String,
    pub(crate) state: String,
    pub(crate) error: Option<String>,
    pub(crate) error_description: Option<String>,
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
    pub(crate) pending_navigation:
        Arc<Mutex<Option<crate::desktop::state::NotificationNavigationTarget>>>,
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
    #[serde(default)]
    #[allow(dead_code)]
    data: serde_json::Value,
}

impl NativeNotification {
    pub(crate) fn navigation_target(&self) -> Option<NotificationNavigationTarget> {
        let record = self.data.as_object()?;
        let room_id = string_field(record, "roomId").or_else(|| string_field(record, "room"));
        let channel_id =
            string_field(record, "channelId").or_else(|| string_field(record, "channel"));
        if let Some(room_id) = room_id {
            return Some(NotificationNavigationTarget::Room {
                room_id,
                channel_id,
            });
        }
        let conversation_id = string_field(record, "conversationId")
            .or_else(|| string_field(record, "conversation_id"))
            .or_else(|| string_field(record, "friendId"));
        if let Some(conversation_id) = conversation_id {
            return Some(NotificationNavigationTarget::DirectMessage { conversation_id });
        }
        None
    }
}

fn string_field(record: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
    match record.get(key)? {
        serde_json::Value::String(value) if !value.is_empty() => Some(value.clone()),
        serde_json::Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum NotificationNavigationTarget {
    Room {
        room_id: String,
        channel_id: Option<String>,
    },
    DirectMessage {
        conversation_id: String,
    },
}

#[derive(Clone, PartialEq)]
pub(crate) struct TrayConnectionState {
    pub(crate) connected: bool,
    pub(crate) channel_name: Option<String>,
}

impl TrayConnectionState {
    pub(crate) fn menu_label(&self) -> String {
        match (&self.connected, self.channel_name.as_deref()) {
            (true, Some(name)) => format!("Disconnect from {name}"),
            (true, None) => "Disconnect from voice channel".to_string(),
            (false, _) => "Disconnect from voice channel".to_string(),
        }
    }
}

static TRAY_CONNECTION: Mutex<Option<TrayConnectionState>> = Mutex::new(None);

pub(crate) fn update_tray_connection_state(state: &TrayConnectionState) -> bool {
    let mut current = TRAY_CONNECTION.lock().expect("tray connection lock");
    let changed = current.as_ref() != Some(state);
    if changed {
        *current = Some(state.clone());
    }
    changed
}

pub(crate) fn current_tray_connection_state() -> TrayConnectionState {
    TRAY_CONNECTION
        .lock()
        .expect("tray connection lock")
        .clone()
        .unwrap_or(TrayConnectionState {
            connected: false,
            channel_name: None,
        })
}

pub(crate) static HIDE_ON_CLOSE: AtomicBool = AtomicBool::new(true);

pub(crate) static LAUNCH_AT_LOGIN: AtomicBool = AtomicBool::new(true);

#[cfg(test)]
mod tests {
    use super::{NativeNotification, NotificationNavigationTarget};

    fn notification_with_data(data: serde_json::Value) -> NativeNotification {
        serde_json::from_value(serde_json::json!({
            "id": "n-1",
            "title": "t",
            "body": "b",
            "created": "2026-08-23T00:00:00Z",
            "data": data,
        }))
        .unwrap()
    }

    #[test]
    fn room_notification_maps_to_room_target() {
        let item = notification_with_data(serde_json::json!({
            "roomId": "room-1", "channelId": "ch-1",
        }));
        assert_eq!(
            item.navigation_target(),
            Some(NotificationNavigationTarget::Room {
                room_id: "room-1".to_string(),
                channel_id: Some("ch-1".to_string()),
            })
        );
    }

    #[test]
    fn direct_message_notification_maps_to_conversation_target() {
        let item = notification_with_data(serde_json::json!({
            "conversationId": "c-9", "senderId": "s-2",
        }));
        assert_eq!(
            item.navigation_target(),
            Some(NotificationNavigationTarget::DirectMessage {
                conversation_id: "c-9".to_string(),
            })
        );
    }

    #[test]
    fn notifications_without_navigable_data_have_no_target() {
        let empty = notification_with_data(serde_json::json!({}));
        assert_eq!(empty.navigation_target(), None);
        let missing = NativeNotification {
            id: "n-2".to_string(),
            title: "t".to_string(),
            body: "b".to_string(),
            created: "2026-08-23T00:00:00Z".to_string(),
            data: serde_json::Value::Null,
        };
        assert_eq!(missing.navigation_target(), None);
    }
}
