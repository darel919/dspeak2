use super::state::{OAuthCallback, OAuthServerState, OAuthState};
use super::window::open_main_window;
use axum::extract::{Query, State as AxumState};
use axum::response::Html;
use axum::routing::get;
use axum::Router;
use std::collections::HashMap;
use tauri::{Emitter, State};

fn parse_oauth_callback(params: &HashMap<String, String>) -> Result<OAuthCallback, &'static str> {
    if params.get("error").is_some_and(|value| !value.is_empty()) {
        return Err("authentication failed");
    }

    let code = params.get("code").cloned().unwrap_or_default();
    if code.is_empty() {
        return Err("missing authorization code");
    }

    Ok(OAuthCallback {
        code,
        state: params.get("state").cloned().unwrap_or_default(),
    })
}

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
        let callback = match parse_oauth_callback(&params) {
            Ok(callback) => callback,
            Err("authentication failed") => {
                return Html(
                    r#"<html><body><h1>Authentication failed</h1><p>Return to dSpeak and try again.</p></body></html>"#
                        .to_string(),
                )
            }
            Err(_) => {
                return Html(
                    r#"<html><body><h1>Invalid callback</h1><p>Missing authorization code</p></body></html>"#
                        .to_string(),
                )
            }
        };
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

#[cfg(test)]
mod tests {
    use super::parse_oauth_callback;
    use std::collections::HashMap;

    #[test]
    fn accepts_provider_callback_with_code_only() {
        let params = HashMap::from([(String::from("code"), String::from("oauth-code"))]);
        let callback = parse_oauth_callback(&params).expect("code-only callback should pass");
        assert_eq!(callback.code, "oauth-code");
        assert!(callback.state.is_empty());
    }

    #[test]
    fn rejects_callback_without_code() {
        let params = HashMap::new();
        assert!(matches!(
            parse_oauth_callback(&params),
            Err("missing authorization code")
        ));
    }

    #[test]
    fn rejects_provider_error_callback() {
        let params = HashMap::from([(String::from("error"), String::from("access_denied"))]);
        assert!(matches!(
            parse_oauth_callback(&params),
            Err("authentication failed")
        ));
    }
}
