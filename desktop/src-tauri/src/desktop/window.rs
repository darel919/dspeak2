use super::state::HIDE_ON_CLOSE;
use crate::media;
use std::sync::atomic::Ordering;
use tauri::Manager;
use tauri::WebviewUrl;

const DESKTOP_PREFERENCES_FILE: &str = "desktop-preferences.json";

#[tauri::command]
pub fn desktop_ready(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("init") {
        let _ = window.close();
    }
    open_main_window(&app)?;
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
}

pub(crate) fn attach_main_window_lifecycle(window: &tauri::WebviewWindow) {
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if HIDE_ON_CLOSE.load(Ordering::Relaxed) {
                api.prevent_close();
                let _ = save_window_state_sync(&window_clone);
                if media::is_connected(&window_clone.app_handle()) {
                    media::clear_video_surfaces(&window_clone.app_handle());
                    let _ = window_clone.hide();
                } else {
                    let _ = window_clone.destroy();
                }
            } else {
                api.prevent_close();
                let _ = save_window_state_sync(&window_clone);
                let app = window_clone.app_handle();
                media::shutdown_for_exit(app.state::<media::NativeMediaStore>().inner());
                app.exit(0);
            }
        }
    });
}

fn save_window_state_sync(window: &tauri::WebviewWindow) -> Result<(), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let is_minimized = window.is_minimized().map_err(|error| error.to_string())?;
    let state = serde_json::json!({
        "x": position.x,
        "y": position.y,
        "width": size.width,
        "height": size.height,
        "minimized": is_minimized,
    });
    let app_dir = window
        .app_handle()
        .path()
        .resolve("", tauri::path::BaseDirectory::AppConfig)
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&app_dir).map_err(|error| error.to_string())?;
    std::fs::write(app_dir.join("window.json"), state.to_string())
        .map_err(|error| error.to_string())
}

pub(crate) fn open_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let window =
        tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
            .title("dSpeak")
            .inner_size(1200.0, 800.0)
            .resizable(true)
            .fullscreen(false)
            .visible(false)
            .build()
            .map_err(|error| error.to_string())?;
    attach_main_window_lifecycle(&window);
    let state_window = window.clone();
    tauri::async_runtime::spawn(async move {
        let _ = restore_window_state(state_window).await;
    });
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_window_state(window: tauri::WebviewWindow) -> Result<(), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let is_minimized = window.is_minimized().map_err(|error| error.to_string())?;

    let state = serde_json::json!({
        "x": position.x,
        "y": position.y,
        "width": size.width,
        "height": size.height,
        "minimized": is_minimized,
    });

    let app_dir = window
        .app_handle()
        .path()
        .resolve("", tauri::path::BaseDirectory::AppConfig)
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&app_dir).map_err(|error| error.to_string())?;
    std::fs::write(app_dir.join("window.json"), state.to_string())
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn restore_window_state(window: tauri::WebviewWindow) -> Result<(), String> {
    let app_dir = window
        .app_handle()
        .path()
        .resolve("", tauri::path::BaseDirectory::AppConfig)
        .map_err(|error| error.to_string())?;
    let path = app_dir.join("window.json");

    if !path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let state: serde_json::Value =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;

    let x = state["x"].as_i64().unwrap_or(0) as i32;
    let y = state["y"].as_i64().unwrap_or(0) as i32;
    let width = state["width"].as_u64().unwrap_or(1200) as u32;
    let height = state["height"].as_u64().unwrap_or(800) as u32;

    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(width, height))
        .map_err(|error| error.to_string())?;

    Ok(())
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
