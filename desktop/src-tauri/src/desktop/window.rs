use super::state::HIDE_ON_CLOSE;
use std::sync::atomic::Ordering;
use tauri::Manager;

#[tauri::command]
pub fn desktop_ready(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("init") {
        let _ = window.close();
    }
    open_main_window(&app)?;
    Ok(())
}

pub(crate) fn attach_main_window_lifecycle(window: &tauri::WebviewWindow) {
    let window_clone = window.clone();
    let _ = window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            if HIDE_ON_CLOSE.load(Ordering::Relaxed) {
                api.prevent_close();
                let _ = save_window_state_sync(&window_clone);
                let _ = window_clone.destroy();
            } else {
                let state_window = window_clone.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = save_window_state(state_window).await;
                });
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

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or_else(|| "main window configuration is missing".to_string())?;
    let window = tauri::WebviewWindowBuilder::from_config(app, config)
        .map_err(|error| error.to_string())?
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
pub async fn set_hide_on_close(enabled: bool) {
    HIDE_ON_CLOSE.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
pub async fn get_hide_on_close() -> bool {
    HIDE_ON_CLOSE.load(Ordering::Relaxed)
}
