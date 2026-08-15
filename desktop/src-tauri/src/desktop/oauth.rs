use super::state::{OAuthCallback, OAuthServerState, OAuthState};
use super::window::open_main_window;
use axum::extract::{Query, State as AxumState};
use axum::response::Html;
use axum::routing::get;
use axum::Router;
use std::collections::HashMap;
use tauri::{Emitter, State};
use tokio::time::{timeout, Duration};

fn parse_oauth_callback(params: &HashMap<String, String>) -> OAuthCallback {
    let provider_error = params
        .get("error")
        .filter(|value| !value.is_empty())
        .cloned();
    let missing_code = provider_error.is_none()
        && params
            .get("code")
            .map(|value| value.is_empty())
            .unwrap_or(true);
    OAuthCallback {
        code: if provider_error.is_none() {
            params.get("code").cloned().unwrap_or_default()
        } else {
            String::new()
        },
        state: params.get("state").cloned().unwrap_or_default(),
        error: provider_error
            .or_else(|| missing_code.then(|| "missing_authorization_code".to_string())),
        error_description: params.get("error_description").cloned(),
    }
}

#[tauri::command]
pub async fn get_oauth_callback_url(state: State<'_, OAuthState>) -> Result<String, String> {
    let ready = state.ready.clone();
    let callback_ready = state.callback_url.lock().unwrap().is_some();
    if !callback_ready {
        timeout(Duration::from_secs(5), ready.notified())
            .await
            .map_err(|_| "DESKTOP_OAUTH_CALLBACK_SERVER_UNAVAILABLE".to_string())?;
    }
    *state.pending_callback.lock().unwrap() = None;
    state
        .callback_url
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "DESKTOP_OAUTH_CALLBACK_SERVER_UNAVAILABLE".to_string())
}

#[tauri::command]
pub fn get_pending_oauth_callback(
    state: State<'_, OAuthState>,
) -> Option<super::state::OAuthCallback> {
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
        let callback = parse_oauth_callback(&params);
        *server.oauth.pending_callback.lock().unwrap() = Some(callback.clone());
        let _ = open_main_window(&server.app);
        let _ = server.app.emit("oauth-callback", callback.clone());

        if callback.error.is_some() {
            return Html(
                "<html><body><h1>Authentication failed</h1><p>Return to dSpeak and try again.</p></body></html>"
                    .to_string(),
            );
        }

        Html(
            "<html><body><h1>Authentication successful</h1><p>You can close this window and return to dSpeak.</p></body></html>"
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

    *oauth_state.callback_url.lock().unwrap() = Some(callback_url);
    oauth_state.ready.notify_waiters();

    eprintln!("[dspeak] OAuth callback server ready");
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_oauth_callback;
    use std::collections::HashMap;

    #[test]
    fn accepts_provider_callback_with_code_and_state() {
        let params = HashMap::from([
            (String::from("code"), String::from("oauth-code")),
            (String::from("state"), String::from("oauth-state")),
        ]);
        let callback = parse_oauth_callback(&params);
        assert_eq!(callback.code, "oauth-code");
        assert_eq!(callback.state, "oauth-state");
        assert!(callback.error.is_none());
    }

    #[test]
    fn rejects_callback_without_code() {
        let callback = parse_oauth_callback(&HashMap::new());
        assert_eq!(
            callback.error.as_deref(),
            Some("missing_authorization_code")
        );
        assert!(callback.code.is_empty());
    }

    #[test]
    fn captures_provider_error_without_auth_material() {
        let params = HashMap::from([
            (String::from("error"), String::from("access_denied")),
            (
                String::from("error_description"),
                String::from("The user cancelled sign-in"),
            ),
        ]);
        let callback = parse_oauth_callback(&params);
        assert_eq!(callback.error.as_deref(), Some("access_denied"));
        assert_eq!(
            callback.error_description.as_deref(),
            Some("The user cancelled sign-in")
        );
        assert!(callback.code.is_empty());
    }
}
