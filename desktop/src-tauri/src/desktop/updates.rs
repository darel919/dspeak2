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
    let updater = create_updater(&app)?;
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
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = create_updater(&app)?;
    if let Some(update) = updater.check().await.map_err(|error| error.to_string())? {
        update
            .download_and_install(|_chunk, _total| {}, || {})
            .await
            .map_err(|error| error.to_string())?;
        app.restart();
    }
    Ok(())
}

fn create_updater(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let builder = if let Some(public_key) = option_env!("DSPEAK_TAURI_PUBLIC_KEY") {
        app.updater_builder().pubkey(public_key)
    } else {
        app.updater_builder()
    };
    builder.build().map_err(|error| error.to_string())
}
