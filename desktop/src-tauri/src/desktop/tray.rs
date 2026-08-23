use super::state::{TrayConnectionState, LAUNCH_AT_LOGIN};
use super::window::DESKTOP_PREFERENCES_FILE;
use crate::media;
use std::sync::atomic::Ordering;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const DISCONNECT_ITEM_ID: &str = "disconnect_voice";

pub(crate) fn create_tray(
    app: &tauri::AppHandle,
) -> Result<tauri::tray::TrayIcon, Box<dyn std::error::Error>> {
    let toggle_mute = MenuItem::with_id(app, "toggle_mute", "Toggle Mute", true, None::<&str>)?;
    let open_window = MenuItem::with_id(app, "open_window", "Open dSpeak", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&toggle_mute, &open_window, &quit])?;

    let tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Err(error) = super::window::open_main_window(tray.app_handle()) {
                    eprintln!("[dspeak] failed to open main window from tray: {error}");
                }
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle_mute" => {
                let _ = app.emit("tray:mute-toggle", ());
            }
            DISCONNECT_ITEM_ID => {
                let _ = app.emit("tray:disconnect-voice", ());
            }
            "open_window" => {
                if let Err(error) = super::window::open_main_window(app) {
                    eprintln!("[dspeak] failed to open main window from tray menu: {error}");
                }
            }
            "quit" => quit_with_confirmation(app.to_owned()),
            _ => {}
        })
        .icon(app.default_window_icon().unwrap().clone())
        .build(app)?;

    Ok(tray)
}

fn rebuild_menu_with_disconnect(app: &tauri::AppHandle, state: &TrayConnectionState) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    let Ok(connected_item) = MenuItem::with_id(
        app,
        DISCONNECT_ITEM_ID,
        state.menu_label(),
        true,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(toggle_mute) = MenuItem::with_id(app, "toggle_mute", "Toggle Mute", true, None::<&str>)
    else {
        return;
    };
    let Ok(open_window) = MenuItem::with_id(app, "open_window", "Open dSpeak", true, None::<&str>)
    else {
        return;
    };
    let Ok(quit) = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>) else {
        return;
    };
    let Ok(menu) = Menu::with_items(app, &[&connected_item, &toggle_mute, &open_window, &quit])
    else {
        return;
    };
    let _ = tray.set_menu(Some(menu));
}

pub(crate) fn update_connection_state(
    app: &tauri::AppHandle,
    connected: bool,
    channel_name: Option<String>,
) {
    let state = TrayConnectionState {
        connected,
        channel_name,
    };
    let changed = super::state::update_tray_connection_state(&state);
    if changed || state.connected {
        rebuild_menu_with_disconnect(app, &state);
    }
}

fn quit_with_confirmation(app: tauri::AppHandle) {
    let snapshot = super::state::current_tray_connection_state();
    if !snapshot.connected {
        media::shutdown_for_exit(app.state::<media::NativeMediaStore>().inner());
        app.exit(0);
        return;
    }
    let message = match &snapshot.channel_name {
        Some(name) => format!(
            "You are still connected to \"{name}\". Quitting will disconnect you. Quit anyway?"
        ),
        None => {
            "You are still connected to a voice channel. Quitting will disconnect you. Quit anyway?"
                .to_string()
        }
    };
    app.dialog()
        .message(message)
        .title("Quit dSpeak")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Disconnect and quit".to_string(),
            "Cancel".to_string(),
        ))
        .show(move |confirmed| {
            if !confirmed {
                return;
            }
            media::shutdown_for_exit(app.state::<media::NativeMediaStore>().inner());
            app.exit(0);
        });
}

pub(crate) fn setup_global_shortcuts(app: &tauri::AppHandle) {
    let shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Backquote);
    if let Err(error) =
        app.global_shortcut()
            .on_shortcut(shortcut, |app, _event, state| match state.state {
                ShortcutState::Pressed => {
                    let _ = app.emit("ptt:press", ());
                }
                ShortcutState::Released => {
                    let _ = app.emit("ptt:release", ());
                }
            })
    {
        eprintln!("[dspeak] PTT shortcut handler registration failed: {error}");
    }
    if let Err(error) = app.global_shortcut().register(shortcut) {
        eprintln!("[dspeak] PTT hotkey registration failed: {error}");
    }
}

fn persist_launch_at_login(app: &tauri::AppHandle, launch_at_login: bool) -> Result<(), String> {
    LAUNCH_AT_LOGIN.store(launch_at_login, Ordering::Relaxed);
    let app_dir = app
        .path()
        .resolve("", tauri::path::BaseDirectory::AppConfig)
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&app_dir).map_err(|error| error.to_string())?;
    let path = app_dir.join(DESKTOP_PREFERENCES_FILE);
    let mut preferences = match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str::<serde_json::Value>(&content)
            .unwrap_or_else(|_| serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    };
    preferences["launchAtLogin"] = serde_json::Value::Bool(launch_at_login);
    std::fs::write(path, preferences.to_string()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_tray_presence(app: tauri::AppHandle, status: String) -> Result<(), String> {
    let (connected, channel_name) = match status.as_str() {
        "" => (false, None),
        rest => (true, Some(rest.to_string())),
    };
    update_connection_state(&app, connected, channel_name);
    Ok(())
}

#[tauri::command]
pub async fn register_ptt(app: tauri::AppHandle) -> Result<(), String> {
    let shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyM);
    app.global_shortcut()
        .register(shortcut)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn unregister_ptt(app: tauri::AppHandle) -> Result<(), String> {
    let shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyM);
    app.global_shortcut()
        .unregister(shortcut)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        app.autolaunch()
            .enable()
            .map_err(|error| error.to_string())?;
    } else {
        app.autolaunch()
            .disable()
            .map_err(|error| error.to_string())?;
    }
    persist_launch_at_login(&app, enabled)?;
    Ok(())
}

#[tauri::command]
pub async fn get_autostart(app: tauri::AppHandle) -> Result<bool, String> {
    let registered = app
        .autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())?;
    Ok(LAUNCH_AT_LOGIN.load(Ordering::Relaxed) || registered)
}
