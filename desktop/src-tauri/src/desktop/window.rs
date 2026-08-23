use super::state::{HIDE_ON_CLOSE, LAUNCH_AT_LOGIN};
use crate::media;
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::Manager;
use tauri::WebviewUrl;
use tauri::WebviewWindow;

pub(crate) const DESKTOP_PREFERENCES_FILE: &str = "desktop-preferences.json";
const MAIN_WINDOW_LABEL: &str = "main";
pub(crate) const STARTUP_WINDOW_LABEL: &str = "init";
pub(crate) const STARTUP_WINDOW_TITLE: &str = "Preparing dSpeak";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[expect(dead_code, reason = "wire contract consumed by tests and frontend")]
pub(crate) enum StartupPhase {
    Starting,
    Runtime,
    DesktopUpdate,
    RepositoryUpdate,
    Authentication,
    Workspace,
    Ready,
    Error,
}

impl StartupPhase {
    #[expect(dead_code, reason = "wire contract consumed by tests and frontend")]
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            StartupPhase::Starting => "starting",
            StartupPhase::Runtime => "runtime",
            StartupPhase::DesktopUpdate => "desktop-update",
            StartupPhase::RepositoryUpdate => "repository-update",
            StartupPhase::Authentication => "authentication",
            StartupPhase::Workspace => "workspace",
            StartupPhase::Ready => "ready",
            StartupPhase::Error => "error",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[expect(dead_code, reason = "wire contract consumed by tests and frontend")]
pub(crate) struct DesktopStartupStatus {
    pub(crate) phase: &'static str,
    pub(crate) message: String,
    pub(crate) progress: Option<f64>,
    pub(crate) elapsed_ms: u64,
    pub(crate) error_code: Option<String>,
}

impl DesktopStartupStatus {
    #[expect(dead_code, reason = "wire contract consumed by tests and frontend")]
    pub(crate) fn new(
        phase: StartupPhase,
        message: impl Into<String>,
        progress: Option<f64>,
        elapsed_ms: u64,
        error_code: Option<String>,
    ) -> Self {
        Self {
            phase: phase.as_str(),
            message: message.into(),
            progress: progress.map(|value| value.clamp(0.0, 100.0)),
            elapsed_ms,
            error_code,
        }
    }
}

#[tauri::command]
pub fn desktop_open_devtools(window: WebviewWindow) {
    window.open_devtools();
}

#[tauri::command]
pub fn desktop_close_devtools(window: WebviewWindow) {
    window.close_devtools();
}

#[tauri::command]
pub fn desktop_ready(app: tauri::AppHandle) -> Result<(), String> {
    reveal_main_window(&app)?;
    close_startup_window(&app);
    Ok(())
}

pub(crate) fn load_preferences(app: &tauri::AppHandle) {
    let Ok(app_dir) = app
        .path()
        .resolve("", tauri::path::BaseDirectory::AppConfig)
    else {
        return;
    };
    let path = app_dir.join(DESKTOP_PREFERENCES_FILE);
    let Ok(content) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(preferences) = serde_json::from_str::<serde_json::Value>(&content) else {
        return;
    };
    if let Some(close_to_tray) = preferences
        .get("closeToTray")
        .and_then(|value| value.as_bool())
    {
        HIDE_ON_CLOSE.store(close_to_tray, Ordering::Relaxed);
    }
    if let Some(launch_at_login) = preferences
        .get("launchAtLogin")
        .and_then(|value| value.as_bool())
    {
        LAUNCH_AT_LOGIN.store(launch_at_login, Ordering::Relaxed);
    }
}

pub(crate) fn attach_main_window_lifecycle(window: &tauri::WebviewWindow) {
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if HIDE_ON_CLOSE.load(Ordering::Relaxed) {
                api.prevent_close();
                use tauri_plugin_window_state::AppHandleExt;
                let _ = window_clone
                    .app_handle()
                    .save_window_state(tauri_plugin_window_state::StateFlags::all());
                if media::is_connected(&window_clone.app_handle()) {
                    let _ = window_clone.hide();
                } else {
                    let _ = window_clone.destroy();
                }
            } else {
                api.prevent_close();
                use tauri_plugin_window_state::AppHandleExt;
                let _ = window_clone
                    .app_handle()
                    .save_window_state(tauri_plugin_window_state::StateFlags::all());
                let app = window_clone.app_handle();
                media::shutdown_for_exit(app.state::<media::NativeMediaStore>().inner());
                app.exit(0);
            }
        }
    });
}

/// Create or reuse the compact `init` startup window. Never runs Nuxt.
/// The splash is not user-closable; only `desktop_ready` tears it down
/// through `close_startup_window`.
pub(crate) fn open_startup_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(STARTUP_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = tauri::WebviewWindowBuilder::new(
        app,
        STARTUP_WINDOW_LABEL,
        WebviewUrl::App("desktop-startup.html".into()),
    )
    .title(STARTUP_WINDOW_TITLE)
    .inner_size(320.0, 200.0)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .decorations(false)
    .center()
    .visible(true)
    .build()
    .map_err(|error| error.to_string())?;
    window.on_window_event(|event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
    });
    Ok(window)
}

/// Tear down the `init` startup window if present. Missing is success.
/// Uses `destroy` because `close` emits `CloseRequested`, which the splash
/// always prevents.
pub(crate) fn close_startup_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(STARTUP_WINDOW_LABEL) {
        let _ = window.destroy();
    }
}

/// Create `main` hidden if missing. Reveal happens only in `show_main_window`.
pub(crate) fn ensure_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window(MAIN_WINDOW_LABEL).is_some() {
        return Ok(());
    }

    let window = tauri::WebviewWindowBuilder::new(
        app,
        MAIN_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .devtools(true)
    .title("dSpeak")
    .inner_size(1200.0, 800.0)
    .min_inner_size(480.0, 360.0)
    .resizable(true)
    .fullscreen(false)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;
    attach_main_window_lifecycle(&window);
    Ok(())
}

/// Reveal `main`. Refuses while the `init` splash exists; `desktop_ready`
/// owns the handoff through `reveal_main_window`.
pub(crate) fn show_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    ensure_main_window(app)?;
    if app.get_webview_window(STARTUP_WINDOW_LABEL).is_some() {
        return Ok(());
    }
    reveal_main_window(app)
}

/// Show and focus `main`, restoring it first when minimized. Independent of
/// splash teardown timing so the reveal cannot be lost to a pending close.
fn reveal_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Err("main window is unavailable".to_string());
    };
    if window.is_minimized().map_err(|error| error.to_string())? {
        window.unminimize().map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn open_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    show_main_window(app)
}

#[tauri::command]
pub async fn set_hide_on_close(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    HIDE_ON_CLOSE.store(enabled, Ordering::Relaxed);
    let app_dir = app
        .path()
        .resolve("", tauri::path::BaseDirectory::AppConfig)
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&app_dir).map_err(|error| error.to_string())?;
    let path = app_dir.join(DESKTOP_PREFERENCES_FILE);
    let preferences = serde_json::json!({ "closeToTray": enabled });
    std::fs::write(path, preferences.to_string()).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_hide_on_close() -> bool {
    HIDE_ON_CLOSE.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn open_data_folder(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let directory = super::activity_log::data_dir(&app)
        .ok_or_else(|| "Data folder is unavailable".to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    app.opener()
        .open_path(directory.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{DesktopStartupStatus, StartupPhase};

    #[test]
    fn startup_status_clamps_progress_and_serializes_camel_case() {
        let status = DesktopStartupStatus::new(
            StartupPhase::DesktopUpdate,
            "Downloading update…",
            Some(150.0),
            1200,
            None,
        );
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["phase"], "desktop-update");
        assert_eq!(json["progress"], 100.0);
        assert_eq!(json["elapsedMs"], 1200);
        assert_eq!(json["errorCode"], serde_json::Value::Null);
        assert!(json.get("message").is_some());
    }

    #[test]
    fn startup_status_omits_progress_without_a_known_total() {
        let status = DesktopStartupStatus::new(StartupPhase::Workspace, "Loading…", None, 5, None);
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["progress"], serde_json::Value::Null);
    }

    #[test]
    fn phase_values_match_the_frontend_union() {
        assert_eq!(StartupPhase::Starting.as_str(), "starting");
        assert_eq!(StartupPhase::Runtime.as_str(), "runtime");
        assert_eq!(StartupPhase::DesktopUpdate.as_str(), "desktop-update");
        assert_eq!(StartupPhase::RepositoryUpdate.as_str(), "repository-update");
        assert_eq!(StartupPhase::Authentication.as_str(), "authentication");
        assert_eq!(StartupPhase::Workspace.as_str(), "workspace");
        assert_eq!(StartupPhase::Ready.as_str(), "ready");
        assert_eq!(StartupPhase::Error.as_str(), "error");
    }
}
