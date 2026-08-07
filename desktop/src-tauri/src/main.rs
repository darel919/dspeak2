#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use axum::{
    extract::{Query, State},
    response::Html,
    routing::get,
    Router,
};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Emitter;
use tauri::Listener;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;
use tokio::time::sleep;

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

#[derive(Clone)]
struct BackgroundNotificationState {
    session: std::sync::Arc<Mutex<Option<BackgroundNotificationSession>>>,
    enabled: std::sync::Arc<AtomicBool>,
}

#[derive(Clone)]
struct BackgroundNotificationSession {
    server_url: String,
    token: String,
    baseline_complete: bool,
    cursor: Option<String>,
    seen_ids: HashSet<String>,
}

#[derive(serde::Deserialize)]
struct NotificationSyncResponse {
    items: Vec<NativeNotification>,
}

#[derive(serde::Deserialize)]
struct NativeNotification {
    id: String,
    title: String,
    body: String,
    created: String,
}

static HIDE_ON_CLOSE: AtomicBool = AtomicBool::new(true);

fn main() {
    let result = tauri::Builder::default()
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
        .manage(BackgroundNotificationState {
            session: std::sync::Arc::new(Mutex::new(None)),
            enabled: std::sync::Arc::new(AtomicBool::new(false)),
        })
        .manage(media::NativeMediaStore::default())
        .setup(|app| {
            maintain_log_directory(app.handle());
            if let Err(error) =
                media::strict_startup_check(app.state::<media::NativeMediaStore>().inner())
            {
                report_fatal(
                    app.handle(),
                    "Native media startup failed",
                    &error.to_string(),
                );
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.close();
                }
                if let Some(window) = app.get_webview_window("init") {
                    let _ = window.close();
                }
                return Err(error.into());
            }

            let log_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    sleep(Duration::from_secs(24 * 60 * 60)).await;
                    maintain_log_directory(&log_handle);
                }
            });

            let oauth_state = app.state::<OAuthState>().inner().clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_oauth_callback_server(oauth_state, app_handle).await {
                    eprintln!("[dspeak] OAuth callback server error: {e}");
                }
            });

            let notification_state = app.state::<BackgroundNotificationState>().inner().clone();
            let notification_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                run_background_notification_poller(notification_app, notification_state).await;
            });

            let handle = app.handle().clone();
            app.listen("deep-link://new-url", move |event| {
                let _ = open_main_window(&handle);
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.eval(&format!(
                        "window.__TAURI_DEEP_LINK__ = {}",
                        serde_json::to_string(&event.payload()).unwrap_or_default()
                    ));
                }
            });

            let _ = create_tray(app.handle())?;
            setup_global_shortcuts(app.handle());

            if let Some(window) = app.get_webview_window("main") {
                let state_window = window.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = restore_window_state(state_window).await;
                });
            }

            if let Some(window) = app.get_webview_window("main") {
                attach_main_window_lifecycle(&window);
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
            desktop_ready,
            register_background_notifications,
            clear_background_notifications,
            set_background_notifications_enabled,
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
            media::media_create_device,
            media::media_create_send_transport,
            media::media_create_recv_transport,
            media::media_consume,
            media::media_set_consumer_enabled,
            media::media_set_consumer_volume,
            media::media_close_consumer,
            media::media_p2p_create,
            media::media_p2p_destroy,
            media::media_p2p_create_offer,
            media::media_p2p_create_answer,
            media::media_p2p_set_remote_description,
            media::media_p2p_add_ice_candidate,
            media::media_p2p_poll_ice_candidate,
            media::media_p2p_ice_state,
            media::media_p2p_restart_ice,
            media::media_p2p_add_track,
            media::media_p2p_remove_track,
            media::media_p2p_set_track_parameters,
            media::media_p2p_set_audio_stereo,
            media::media_p2p_set_receive_enabled,
            media::media_p2p_send_health,
            media::media_p2p_poll_event,
            media::media_poll_action,
            media::media_poll_receive_event,
            media::media_complete_connect,
            media::media_fail_connect,
            media::media_complete_produce,
            media::media_fail_produce,
            media::media_create_capture_producer,
            media::media_set_producer_paused,
            media::media_set_producer_parameters,
            media::media_remove_capture_producer,
            media::media_set_microphone,
            media::media_set_microphone_device,
            media::media_set_output_device,
            media::media_set_camera,
            media::media_start_screen_share,
            media::media_replace_screen_share,
            media::media_stop_screen_share,
            media::media_start_system_audio,
            media::media_replace_system_audio,
            media::media_stop_system_audio,
            media::media_restart_send_transport_ice,
            media::media_restart_recv_transport_ice,
            media::media_get_transport_stats,
            media::media_get_producer_stats,
            media::media_get_consumer_stats,
            media::media_replace_producer_track,
            media::media_set_consumer_jitter_buffer,
        ])
        .run(tauri::generate_context!());

    if let Err(error) = result {
        let fallback = std::env::temp_dir().join("dspeak-fatal.log");
        let _ = std::fs::write(&fallback, error.to_string());
        eprintln!("[dspeak:fatal-startup] {error}");
        show_native_fatal_dialog("dSpeak failed to start", &error.to_string());
        std::process::exit(1);
    }
}

fn maintain_log_directory(app: &tauri::AppHandle) {
    let Ok(directory) = app.path().app_log_dir() else {
        return;
    };
    if std::fs::create_dir_all(&directory).is_err() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(&directory) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let Ok(modified) = entry.metadata().and_then(|value| value.modified()) else {
            continue;
        };
        if now.duration_since(modified).unwrap_or_default() > Duration::from_secs(24 * 60 * 60) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn report_fatal(app: &tauri::AppHandle, title: &str, detail: &str) {
    if let Ok(directory) = app.path().app_log_dir() {
        let _ = std::fs::create_dir_all(&directory);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let _ = std::fs::write(
            directory.join(format!("fatal-{timestamp}.log")),
            format!("{title}\n\n{detail}"),
        );
    }
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(detail)
        .show();
    show_native_fatal_dialog(title, detail);
    std::thread::sleep(Duration::from_millis(500));
}

fn show_native_fatal_dialog(title: &str, detail: &str) {
    #[cfg(target_os = "macos")]
    {
        let escape = |value: &str| {
            value
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', " ")
        };
        let message = format!(
            "display dialog \"{}\" with title \"{}\" buttons {{\"OK\"}} default button \"OK\"",
            escape(detail),
            escape(title),
        );
        let _ = std::process::Command::new("osascript")
            .args(["-e", message.as_str()])
            .status();
    }
}

#[tauri::command]
fn desktop_ready(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("init") {
        let _ = window.close();
    }
    open_main_window(&app)?;
    Ok(())
}

fn attach_main_window_lifecycle(window: &tauri::WebviewWindow) {
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

fn open_main_window(app: &tauri::AppHandle) -> Result<(), String> {
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
        let _ = open_main_window(&server.app);
        let _ = server.app.emit("oauth-callback", callback);

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
                media::shutdown_for_exit(app.state::<media::NativeMediaStore>().inner());
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
async fn register_background_notifications(
    state: tauri::State<'_, BackgroundNotificationState>,
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
    Ok(())
}

#[tauri::command]
async fn clear_background_notifications(
    state: tauri::State<'_, BackgroundNotificationState>,
) -> Result<(), String> {
    *state
        .session
        .lock()
        .map_err(|_| "Notification state is unavailable")? = None;
    Ok(())
}

#[tauri::command]
async fn set_background_notifications_enabled(
    state: tauri::State<'_, BackgroundNotificationState>,
    enabled: bool,
) -> Result<(), String> {
    state.enabled.store(enabled, Ordering::Relaxed);
    Ok(())
}

async fn run_background_notification_poller(
    app: tauri::AppHandle,
    state: BackgroundNotificationState,
) {
    let client = reqwest::Client::new();
    loop {
        let session = state.session.lock().ok().and_then(|value| value.clone());
        if let Some(session) = session {
            if let Ok(response) = fetch_background_notifications(&client, &session).await {
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
        }
        sleep(Duration::from_secs(30)).await;
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
