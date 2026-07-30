#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use axum::{
    extract::{Query, State},
    response::Html,
    routing::get,
    Router,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Emitter;
use tauri::Listener;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

mod media;

#[derive(Clone)]
struct OAuthState {
    callback_url: std::sync::Arc<Mutex<Option<String>>>,
    pending_callback: std::sync::Arc<Mutex<Option<OAuthCallback>>>,
}

#[derive(Clone, serde::Serialize)]
struct OAuthCallback {
    code: String,
    state: String,
}

#[derive(Clone)]
struct OAuthServerState {
    app: tauri::AppHandle,
    oauth: OAuthState,
}

static HIDE_ON_CLOSE: AtomicBool = AtomicBool::new(true);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_keyring_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(OAuthState {
            callback_url: std::sync::Arc::new(Mutex::new(None)),
            pending_callback: std::sync::Arc::new(Mutex::new(None)),
        })
        .manage(media::NativeMediaStore::default())
        .setup(|app| {
            let oauth_state = app.state::<OAuthState>().inner().clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_oauth_callback_server(oauth_state, app_handle).await {
                    eprintln!("[dspeak] OAuth callback server error: {e}");
                }
            });

            let handle = app.handle().clone();
            app.listen("deep-link://new-url", move |event| {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.eval(&format!(
                        "window.__TAURI_DEEP_LINK__ = {}",
                        serde_json::to_string(&event.payload()).unwrap_or_default()
                    ));
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });

            let _ = create_tray(app.handle())?;
            setup_global_shortcuts(app.handle());

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(3)).await;
                if let Ok(updater) = handle.updater() {
                    if let Ok(Some(update)) = updater.check().await {
                        let _ = update
                            .download_and_install(|_chunk, _total| {}, || {})
                            .await;
                    }
                }
            });

            if let Some(window) = app.get_webview_window("main") {
                let _ = restore_window_state(window.clone());
            }

            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if HIDE_ON_CLOSE.load(Ordering::Relaxed) {
                            let _ = window_clone.hide();
                            api.prevent_close();
                        } else {
                            let _ = save_window_state(window_clone.clone());
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_tray_presence,
            register_ptt,
            unregister_ptt,
            set_autostart,
            get_autostart,
            check_for_updates,
            install_update,
            show_notification,
            save_window_state,
            restore_window_state,
            set_hide_on_close,
            get_hide_on_close,
            get_oauth_callback_url,
            get_pending_oauth_callback,
            media::media_initialize,
            media::media_join,
            media::media_leave,
            media::media_shutdown,
            media::media_set_topology,
            media::media_set_ice_servers,
            media::media_handle_signal,
            media::media_get_devices,
            media::media_list_capture_sources,
            media::media_get_permissions,
            media::media_select_capture_source,
            media::media_get_capabilities,
            media::media_get_stats,
            media::media_set_microphone,
            media::media_set_microphone_device,
            media::media_set_output_device,
            media::media_set_camera,
            media::media_start_screen_share,
            media::media_stop_screen_share,
            media::media_start_system_audio,
            media::media_stop_system_audio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running dspeak desktop");
}

#[tauri::command]
fn get_oauth_callback_url(state: tauri::State<OAuthState>) -> Result<String, String> {
    *state.pending_callback.lock().unwrap() = None;
    state
        .callback_url
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "OAuth callback server not ready".to_string())
}

#[tauri::command]
fn get_pending_oauth_callback(state: tauri::State<OAuthState>) -> Option<OAuthCallback> {
    state.pending_callback.lock().unwrap().clone()
}

async fn start_oauth_callback_server(
    oauth_state: OAuthState,
    app_handle: tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    async fn callback(
        State(server): State<OAuthServerState>,
        Query(params): Query<HashMap<String, String>>,
    ) -> Html<String> {
        let code = params.get("code").cloned().unwrap_or_default();
        let state = params.get("state").cloned().unwrap_or_default();
        let error = params.get("error").cloned().unwrap_or_default();

        if !error.is_empty() {
            return Html(r#"<html><body><h1>Authentication failed</h1><p>Return to dSpeak and try again.</p></body></html>"#.to_string());
        }

        if code.is_empty() || state.is_empty() {
            return Html(
                r#"<html><body><h1>Invalid callback</h1><p>Missing code or state parameter</p></body></html>"#
                    .to_string(),
            );
        }

        let callback = OAuthCallback { code, state };
        *server.oauth.pending_callback.lock().unwrap() = Some(callback.clone());
        let _ = server.app.emit("oauth-callback", callback);
        if let Some(window) = server.app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }

        Html(
            r#"<html><body><h1>Authentication successful</h1><p>You can close this window and return to dSpeak.</p></body></html>"#
                .to_string(),
        )
    }

    let server_state = OAuthServerState {
        app: app_handle,
        oauth: oauth_state.clone(),
    };
    let app = Router::new()
        .route("/callback", get(callback))
        .with_state(server_state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let callback_url = format!("http://127.0.0.1:{}/callback", port);

    *oauth_state.callback_url.lock().unwrap() = Some(callback_url.clone());

    eprintln!(
        "[dspeak] OAuth callback server listening on {}",
        callback_url
    );

    axum::serve(listener, app).await?;
    Ok(())
}

fn create_tray(
    app: &tauri::AppHandle,
) -> Result<tauri::tray::TrayIcon, Box<dyn std::error::Error>> {
    let toggle_mute = MenuItem::with_id(app, "toggle_mute", "Toggle Mute", true, None::<&str>)?;
    let join_last = MenuItem::with_id(app, "join_last", "Join Last Room", true, None::<&str>)?;
    let open_window = MenuItem::with_id(app, "open_window", "Open dSpeak", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&toggle_mute, &join_last, &open_window, &quit])?;

    let tray = TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle_mute" => {
                let _ = app.emit("tray:mute-toggle", ());
            }
            "join_last" => {
                let _ = app.emit("tray:join-last", ());
            }
            "open_window" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .icon(app.default_window_icon().unwrap().clone())
        .build(app)?;

    Ok(tray)
}

fn setup_global_shortcuts(app: &tauri::AppHandle) {
    let shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Backquote);
    if let Err(e) = app
        .global_shortcut()
        .on_shortcut(shortcut.clone(), |app, _event, state| match state.state {
            ShortcutState::Pressed => {
                let _ = app.emit("ptt:press", ());
            }
            ShortcutState::Released => {
                let _ = app.emit("ptt:release", ());
            }
        })
    {
        eprintln!("[dspeak] PTT shortcut handler registration failed: {e}");
    }
    if let Err(e) = app.global_shortcut().register(shortcut) {
        eprintln!("[dspeak] PTT hotkey registration failed: {e}");
    }
}

#[tauri::command]
fn set_tray_presence(_app: tauri::AppHandle, _status: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
async fn register_ptt(app: tauri::AppHandle) -> Result<(), String> {
    let shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyM);
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn unregister_ptt(app: tauri::AppHandle) -> Result<(), String> {
    let shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyM);
    app.global_shortcut()
        .unregister(shortcut)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())?;
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn get_autostart(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfo {
            version: update.version,
            date: update.date.map(|d| d.to_string()),
            body: update.body,
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update
            .download_and_install(|_chunk, _total| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    date: Option<String>,
    body: Option<String>,
}

#[tauri::command]
async fn show_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_window_state(window: tauri::WebviewWindow) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let is_minimized = window.is_minimized().map_err(|e| e.to_string())?;

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
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    std::fs::write(app_dir.join("window.json"), state.to_string()).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn restore_window_state(window: tauri::WebviewWindow) -> Result<(), String> {
    let app_dir = window
        .app_handle()
        .path()
        .resolve("", tauri::path::BaseDirectory::AppConfig)
        .map_err(|e| e.to_string())?;
    let path = app_dir.join("window.json");

    if !path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let state: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let x = state["x"].as_i64().unwrap_or(0) as i32;
    let y = state["y"].as_i64().unwrap_or(0) as i32;
    let width = state["width"].as_u64().unwrap_or(1200) as u32;
    let height = state["height"].as_u64().unwrap_or(800) as u32;

    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(width, height))
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn set_hide_on_close(enabled: bool) {
    HIDE_ON_CLOSE.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
async fn get_hide_on_close() -> bool {
    HIDE_ON_CLOSE.load(Ordering::Relaxed)
}
