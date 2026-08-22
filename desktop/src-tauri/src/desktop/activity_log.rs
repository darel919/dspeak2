use serde_json::Value;
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

const LOG_DIR_NAME: &str = "logs";
const LOG_RETENTION_SECS: u64 = 24 * 60 * 60;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActivityLevel {
    Debug,
    Info,
    Warning,
    Error,
}

impl ActivityLevel {
    fn as_str(self) -> &'static str {
        match self {
            ActivityLevel::Debug => "DEBUG",
            ActivityLevel::Info => "INFO",
            ActivityLevel::Warning => "WARNING",
            ActivityLevel::Error => "ERROR",
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum LogCategory {
    VoiceChannels,
    Notifications,
    AppLifecycle,
}

impl LogCategory {
    fn file_stem(self) -> &'static str {
        match self {
            LogCategory::VoiceChannels => "voice_channels",
            LogCategory::Notifications => "notifications",
            LogCategory::AppLifecycle => "app_lifecycle",
        }
    }
}

pub(crate) fn data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    tauri::Manager::path(app)
        .resolve("", tauri::path::BaseDirectory::AppConfig)
        .ok()
        .filter(|directory| !directory.as_os_str().is_empty())
}

fn log_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let directory = data_dir(app)?.join(LOG_DIR_NAME);
    let _ = std::fs::create_dir_all(&directory);
    Some(directory)
}

#[derive(serde::Serialize)]
struct ActivityEntry<'a> {
    at: &'a str,
    level: &'static str,
    event: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    channel_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    room_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<Value>,
}

pub(crate) fn log_activity(
    app: &tauri::AppHandle,
    category: LogCategory,
    level: ActivityLevel,
    event: &'static str,
    payload: Value,
) {
    let Some(directory) = log_dir(app) else {
        return;
    };
    let line = build_entry(level, event, payload);
    let path = directory.join(format!("{}_{}.log", date_stamp(), category.file_stem()));
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{line}");
    }
}

fn build_entry(level: ActivityLevel, event: &'static str, payload: Value) -> String {
    let mut object = payload.as_object().cloned().unwrap_or_default();
    let channel_id = string_field(&object, "channelId").map(str::to_string);
    let room_id = string_field(&object, "roomId").map(str::to_string);
    let provider = string_field(&object, "provider").map(str::to_string);
    for key in ["channelId", "roomId", "provider"] {
        object.remove(key);
    }
    let entry = ActivityEntry {
        at: format_rfc3339_now().leak(),
        level: level.as_str(),
        event,
        channel_id: channel_id.as_deref(),
        room_id: room_id.as_deref(),
        provider: provider.as_deref(),
        detail: (!object.is_empty()).then_some(Value::Object(object)),
    };
    serde_json::to_string(&entry).unwrap_or_default()
}

fn string_field<'a>(object: &'a serde_json::Map<String, Value>, key: &str) -> Option<&'a str> {
    match object.get(key)? {
        Value::String(value) if !value.is_empty() => Some(value.as_str()),
        _ => None,
    }
}

pub(crate) fn trim_activity_log(app: &tauri::AppHandle) {
    let Some(directory) = log_dir(app) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(&directory) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let Ok(modified) = entry.metadata().and_then(|value| value.modified()) else {
            continue;
        };
        if now.duration_since(modified).unwrap_or_default()
            > Duration::from_secs(LOG_RETENTION_SECS)
        {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn date_stamp() -> String {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let (year, month, day) = civil_from_days((now.as_secs() / 86_400) as i64);
    format!("{year:04}{month:02}{day:02}")
}

fn format_rfc3339_now() -> String {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let days = (now.as_secs() / 86_400) as i64;
    let secs_of_day = now.as_secs() % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{milli:03}Z",
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60,
        milli = now.subsec_millis(),
    )
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    ((if m <= 2 { y + 1 } else { y }), m, d)
}
