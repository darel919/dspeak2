mod media_popups;
mod notifications;
mod oauth;
mod state;
mod tray;
mod updates;
mod window;

use crate::media;
use state::{BackgroundNotificationState, OAuthState};
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::Listener;
use tauri::Manager;
use tokio::time::sleep;

pub(crate) fn run() {
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
            wake: std::sync::Arc::new(tokio::sync::Notify::new()),
        })
        .manage(media_popups::MediaPopupState::default())
        .manage(media::NativeMediaStore::default())
        .setup(|app| {
            maintain_log_directory(app.handle());
            window::load_preferences(app.handle());

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
                if let Err(error) =
                    oauth::start_oauth_callback_server(oauth_state, app_handle).await
                {
                    eprintln!("[dspeak] OAuth callback server error: {error}");
                }
            });

            let notification_state = app.state::<BackgroundNotificationState>().inner().clone();
            let notification_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                notifications::run_background_notification_poller(
                    notification_app,
                    notification_state,
                )
                .await;
            });

            let handle = app.handle().clone();
            app.listen("deep-link://new-url", move |event| {
                let _ = window::open_main_window(&handle);
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.eval(format!(
                        "window.__TAURI_DEEP_LINK__ = {}",
                        serde_json::to_string(&event.payload()).unwrap_or_default()
                    ));
                }
            });

            let _ = tray::create_tray(app.handle())?;
            tray::setup_global_shortcuts(app.handle());

            let media_app = app.handle().clone();
            app.listen(media::MEDIA_EVENT_STATE, move |event| {
                let connected = serde_json::from_str::<serde_json::Value>(event.payload())
                    .ok()
                    .and_then(|payload| payload.get("connected").and_then(|value| value.as_bool()))
                    .unwrap_or(false);
                if connected {
                    return;
                }
                media_popups::close_all(
                    &media_app,
                    media_app.state::<media_popups::MediaPopupState>().inner(),
                );
                if let Some(window) = media_app.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.destroy();
                    }
                }
            });

            let launched_minimized = std::env::args().any(|argument| argument == "--minimized");
            let explicitly_show = std::env::args().any(|argument| argument == "--show");
            let environment_show_override =
                std::env::var("DSPEAK_DESKTOP_SHOW").ok().and_then(|value| {
                    match value.to_ascii_lowercase().as_str() {
                        "1" | "true" => Some(true),
                        "0" | "false" => Some(false),
                        _ => None,
                    }
                });
            let show_on_start = explicitly_show
                || (!launched_minimized && environment_show_override.unwrap_or(true));
            if show_on_start {
                window::open_main_window(app.handle())?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tray::set_tray_presence,
            tray::register_ptt,
            tray::unregister_ptt,
            tray::set_autostart,
            tray::get_autostart,
            updates::check_for_updates,
            updates::install_update,
            notifications::show_notification,
            window::save_window_state,
            window::restore_window_state,
            window::set_hide_on_close,
            window::get_hide_on_close,
            oauth::get_oauth_callback_url,
            oauth::get_pending_oauth_callback,
            window::desktop_ready,
            media_popups::desktop_open_media_popup,
            media_popups::desktop_get_media_popup,
            media_popups::desktop_focus_media_popup,
            media_popups::desktop_close_media_popup,
            media::media_worker_invoke,
            notifications::register_background_notifications,
            notifications::clear_background_notifications,
            notifications::set_background_notifications_enabled,
            media::media_initialize,
            media::media_join,
            media::media_leave,
            media::media_shutdown,
            media::media_close_sfu,
            media::media_set_topology,
            media::media_set_ice_servers,
            media::media_handle_signal,
            media::media_get_devices,
            media::media_prepare_capture,
            media::media_prepare_devices,
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
            media::media_p2p_rollback_local_description,
            media::media_p2p_add_ice_candidate,
            media::media_p2p_ice_state,
            media::media_p2p_restart_ice,
            media::media_p2p_add_track,
            media::media_p2p_remove_track,
            media::media_p2p_replace_track,
            media::media_p2p_set_track_parameters,
            media::media_p2p_set_audio_stereo,
            media::media_p2p_set_receive_enabled,
            media::media_p2p_set_receive_volume,
            media::media_p2p_set_jitter_buffer,
            media::media_p2p_send_health,
            media::media_p2p_get_stats,
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
            media::media_set_camera_device,
            media::media_set_output_device,
            media::media_set_local_video_preview,
            media::media_set_shared_audio_volume,
            media::media_set_shared_audio_attenuation,
            media::media_get_audio_levels,
            media::media_start_microphone_check,
            media::media_stop_microphone_check,
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
        .build(tauri::generate_context!())
        .map(|app| {
            app.run(|app_handle, event| {
                #[cfg(target_os = "macos")]
                if let tauri::RunEvent::Reopen { .. } = event {
                    if let Err(error) = window::open_main_window(app_handle) {
                        eprintln!("[dspeak] failed to open main window from Dock: {error}");
                    }
                }

                #[cfg(not(target_os = "macos"))]
                let _ = (app_handle, event);
            });
        });

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
