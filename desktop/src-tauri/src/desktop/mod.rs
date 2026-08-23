pub(crate) mod activity_log;
mod media_popups;
pub(crate) use media_popups::{route_frame, MediaPopupState};
mod notifications;
mod oauth;
mod popup_renderer;
mod state;
mod tray;
mod updates;
mod window;

#[tauri::command]
fn desktop_restart_app(app: tauri::AppHandle) {
    app.restart()
}

fn should_prevent_tray_exit(close_to_tray: bool, code: Option<i32>) -> bool {
    close_to_tray && code.is_none()
}

fn reconcile_autostart(app: &tauri::AppHandle) {
    if !state::LAUNCH_AT_LOGIN.load(std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    use tauri_plugin_autostart::ManagerExt;
    let autolaunch = app.autolaunch();
    match autolaunch.is_enabled() {
        Ok(true) => {}
        Ok(false) => {
            if let Err(error) = autolaunch.enable() {
                eprintln!("[dspeak] failed to enable launch-at-login default: {error}");
            }
        }
        Err(error) => {
            eprintln!("[dspeak] launch-at-login state check failed: {error}");
        }
    }
}

use crate::media;
use state::{BackgroundNotificationState, OAuthState, HIDE_ON_CLOSE};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Listener;
use tauri::Manager;
use tokio::time::sleep;

pub(crate) fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_keyring_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .with_denylist(&[window::STARTUP_WINDOW_LABEL])
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(OAuthState {
            callback_url: std::sync::Arc::new(Mutex::new(None)),
            pending_callback: std::sync::Arc::new(Mutex::new(None)),
            ready: std::sync::Arc::new(tokio::sync::Notify::new()),
        })
        .manage(BackgroundNotificationState {
            session: std::sync::Arc::new(Mutex::new(None)),
            enabled: std::sync::Arc::new(AtomicBool::new(false)),
            wake: std::sync::Arc::new(tokio::sync::Notify::new()),
            pending_navigation: std::sync::Arc::new(Mutex::new(None)),
        })
        .manage(media_popups::MediaPopupState::default())
        .manage(media::NativeMediaStore::default())
        .setup(|app| {
            activity_log::log_activity(
                app.handle(),
                activity_log::LogCategory::AppLifecycle,
                activity_log::ActivityLevel::Info,
                "app-start",
                serde_json::json!({ "version": app.package_info().version.to_string() }),
            );
            activity_log::trim_activity_log(app.handle());
            window::load_preferences(app.handle());

            let log_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    sleep(Duration::from_secs(24 * 60 * 60)).await;
                    activity_log::trim_activity_log(&log_handle);
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
            reconcile_autostart(app.handle());

            let media_app = app.handle().clone();
            app.listen(media::MEDIA_EVENT_STATE, move |event| {
                let connected = serde_json::from_str::<serde_json::Value>(event.payload())
                    .ok()
                    .and_then(|payload| payload.get("connected").and_then(|value| value.as_bool()))
                    .unwrap_or(false);
                if connected {
                    return;
                }
                media_popups::mark_all_offline(
                    &media_app,
                    media_app.state::<media_popups::MediaPopupState>().inner(),
                );
                if let Some(window) = media_app.get_webview_window("main") {
                    let startup_pending = media_app
                        .get_webview_window(window::STARTUP_WINDOW_LABEL)
                        .is_some();
                    let hidden = window.is_visible().map(|value| !value).unwrap_or(false);
                    if hidden && !startup_pending {
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
                if let Err(error) = window::open_startup_window(app.handle()) {
                    eprintln!("[dspeak] startup window unavailable: {error}");
                }
            }
            window::ensure_main_window(app.handle())?;

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
            window::set_hide_on_close,
            window::get_hide_on_close,
            window::open_data_folder,
            window::desktop_open_devtools,
            window::desktop_close_devtools,
            oauth::get_oauth_callback_url,
            oauth::get_pending_oauth_callback,
            window::desktop_ready,
            media_popups::desktop_open_media_popup,
            media_popups::desktop_get_media_popup,
            media_popups::desktop_focus_media_popup,
            media_popups::desktop_close_media_popup,
            media_popups::desktop_set_media_popup_offline,
            media::media_worker_invoke,
            desktop_restart_app,
            notifications::register_background_notifications,
            notifications::clear_background_notifications,
            notifications::set_background_notifications_enabled,
            notifications::take_pending_notification_navigation,
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
                #[cfg(not(target_os = "macos"))]
                let _ = app_handle;

                if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                    if should_prevent_tray_exit(HIDE_ON_CLOSE.load(Ordering::Relaxed), *code) {
                        api.prevent_exit();
                    }
                }

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

#[cfg(test)]
mod tests {
    use super::should_prevent_tray_exit;

    #[test]
    fn tray_close_prevents_only_implicit_exit() {
        assert!(should_prevent_tray_exit(true, None));
        assert!(!should_prevent_tray_exit(false, None));
        assert!(!should_prevent_tray_exit(true, Some(0)));
    }
}
