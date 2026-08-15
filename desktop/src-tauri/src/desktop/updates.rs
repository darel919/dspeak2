use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Serialize)]
pub(crate) struct UpdateInfo {
    pub(crate) version: String,
    pub(crate) date: Option<String>,
    pub(crate) body: Option<String>,
    pub(crate) commit: Option<String>,
}

#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater =
        create_updater(&app).map_err(|error| format!("DESKTOP_UPDATE_CHECK_FAILED: {error}"))?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfo {
            version: update.version,
            date: update.date.map(|date| date.to_string()),
            body: update.body,
            commit: update
                .raw_json
                .get("commit")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string()),
        })),
        Ok(None) => Ok(None),
        Err(error) => Err(format!("DESKTOP_UPDATE_CHECK_FAILED: {error}")),
    }
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater =
        create_updater(&app).map_err(|error| format!("DESKTOP_UPDATE_INSTALL_FAILED: {error}"))?;
    if let Some(update) = updater
        .check()
        .await
        .map_err(|error| format!("DESKTOP_UPDATE_INSTALL_FAILED: {error}"))?
    {
        update
            .download_and_install(|_chunk, _total| {}, || {})
            .await
            .map_err(|error| format!("DESKTOP_UPDATE_INSTALL_FAILED: {error}"))?;
        app.restart();
    }
    Ok(())
}

fn create_updater(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let public_key = option_env!("DSPEAK_TAURI_PUBLIC_KEY")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "DESKTOP_UPDATE_NOT_CONFIGURED".to_string())?;
    app.updater_builder()
        .pubkey(public_key)
        .build()
        .map_err(|error| error.to_string())
}
