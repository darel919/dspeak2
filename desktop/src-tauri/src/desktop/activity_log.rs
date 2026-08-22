use serde_json::Value;
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

const ACTIVITY_LOG_FILE: &str = "activity-log.json";
const ACTIVITY_LOG_RETENTION_SECS: u64 = 24 * 60 * 60;
const ACTIVITY_LOG_MAX_ENTRIES: usize = 500;

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

pub(crate) fn data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    tauri::Manager::path(app)
        .resolve("", tauri::path::BaseDirectory::AppConfig)
        .ok()
        .filter(|directory| !directory.as_os_str().is_empty())
}

pub(crate) fn activity_log_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let directory = data_dir(app)?;
    let _ = std::fs::create_dir_all(&directory);
    Some(directory.join(ACTIVITY_LOG_FILE))
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

pub(crate) fn record_call_activity(
    app: &tauri::AppHandle,
    level: ActivityLevel,
    event: &'static str,
    payload: Value,
) {
    let Some(path) = activity_log_path(app) else {
        return;
    };
    let entry = build_entry(level, event, payload);
    let mut entries = read_entries(&path).unwrap_or_default();
    entries.push(entry);
    while entries.len() > ACTIVITY_LOG_MAX_ENTRIES {
        entries.remove(0);
    }
    write_entries(&path, &entries);
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

fn read_entries(path: &PathBuf) -> Option<Vec<String>> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_entries(path: &PathBuf, entries: &[String]) {
    let Ok(json) = serde_json::to_string_pretty(entries) else {
        return;
    };
    let temp = path.with_extension("json.tmp");
    if std::fs::File::create(&temp)
        .and_then(|mut file| file.write_all(json.as_bytes()))
        .is_ok()
    {
        let _ = std::fs::rename(&temp, path);
    }
}

pub(crate) fn trim_activity_log(app: &tauri::AppHandle) {
    let Some(path) = activity_log_path(app) else {
        return;
    };
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(ACTIVITY_LOG_RETENTION_SECS))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let kept: Vec<String> = read_entries(&path)
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| entry_is_recent(entry, cutoff))
        .collect();
    write_entries(&path, &kept);
}

fn entry_is_recent(entry: &str, cutoff: SystemTime) -> bool {
    let Ok(record) = serde_json::from_str::<serde_json::Map<String, Value>>(entry) else {
        return false;
    };
    let Some(at) = record.get("at").and_then(Value::as_str) else {
        return false;
    };
    parse_rfc3339_secs(at)
        .map(|secs| SystemTime::UNIX_EPOCH + Duration::from_secs(secs) >= cutoff)
        .unwrap_or(false)
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

fn parse_rfc3339_secs(text: &str) -> Option<u64> {
    if text.len() < 19 {
        return None;
    }
    let year: i64 = text.get(0..4)?.parse().ok()?;
    let month: u32 = text.get(5..7)?.parse().ok()?;
    let day: u32 = text.get(8..10)?.parse().ok()?;
    let hour: u32 = text.get(11..13)?.parse().ok()?;
    let minute: u32 = text.get(14..16)?.parse().ok()?;
    let second: u32 = text.get(17..19)?.parse().ok()?;
    let days = days_from_civil(year, month, day);
    let secs = days * 86_400 + hour as i64 * 3600 + minute as i64 * 60 + second as i64;
    u64::try_from(secs).ok()
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

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let year = if m <= 2 { y - 1 } else { y };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = (year - era * 400) as u64;
    let mp = if m > 2 { m - 3 } else { m + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + d as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe as i64 - 719_468
}
