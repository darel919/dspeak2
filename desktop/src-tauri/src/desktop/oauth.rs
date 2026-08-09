use super::state::{OAuthServerState, OAuthState};
use super::window::open_main_window;
use axum::extract::{Query, State as AxumState};
use axum::response::Html;
use axum::routing::get;
use axum::Router;
use std::collections::HashMap;
use tauri::{Emitter, State};

#[tauri::command]
pub fn get_oauth_callback_url(state: State<OAuthState>) -> Result<String, String> {
    *state.pending_callback.lock().unwrap() = None;
    state
        .callback_url
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "OAuth callback server not ready".to_string())
}

#[tauri::command]
pub fn get_pending_oauth_callback(state: State<OAuthState>) -> Option<super::state::OAuthCallback> {
    state.pending_callback.lock().unwrap().take()
}

pub(crate) async fn start_oauth_callback_server(
    oauth_state: OAuthState,
    app_handle: tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    async fn callback(
        AxumState(server): AxumState<OAuthServerState>,
        Query(params): Query<HashMap<String, String>>,
    ) -> Html<String> {
        let code = params.get("code").cloned().unwrap_or_default();
        let state = params.get("state").cloned().unwrap_or_default();
        let error = params.get("error").cloned().unwrap_or_default();

        if !error.is_empty() {
            return Html(
                r#"<html><body><h1>Authentication failed</h1><p>Return to dSpeak and try again.</p></body></html>"#
                    .to_string(),
            );
        }

        if code.is_empty() || state.is_empty() {
            return Html(
                r#"<html><body><h1>Invalid callback</h1><p>Missing code or state parameter</p></body></html>"#
                    .to_string(),
            );
        }

        let callback = super::state::OAuthCallback { code, state };
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
    let callback_url = format!("http://127.0.0.1:{port}/callback");

    *oauth_state.callback_url.lock().unwrap() = Some(callback_url.clone());

    eprintln!(
        "[dspeak] OAuth callback server listening on {}",
        callback_url
    );

    axum::serve(listener, app).await?;
    Ok(())
}
