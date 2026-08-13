use crate::media;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub(crate) fn create_tray(
    app: &tauri::AppHandle,
) -> Result<tauri::tray::TrayIcon, Box<dyn std::error::Error>> {
    let toggle_mute = MenuItem::with_id(app, "toggle_mute", "Toggle Mute", true, None::<&str>)?;
    let join_last = MenuItem::with_id(app, "join_last", "Join Last Room", true, None::<&str>)?;
    let open_window = MenuItem::with_id(app, "open_window", "Open dSpeak", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&toggle_mute, &join_last, &open_window, &quit])?;

    let tray = TrayIconBuilder::new()
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
            "join_last" => {
                let _ = app.emit("tray:join-last", ());
            }
            "open_window" => {
                if let Err(error) = super::window::open_main_window(app) {
                    eprintln!("[dspeak] failed to open main window from tray menu: {error}");
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

#[tauri::command]
pub fn set_tray_presence(_app: tauri::AppHandle, _status: String) -> Result<(), String> {
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
    Ok(())
}

#[tauri::command]
pub async fn get_autostart(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| error.to_string())
}
