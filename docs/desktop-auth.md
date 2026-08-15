# Desktop authentication and update configuration

The packaged Tauri client owns its Supabase PKCE session. It asks the native
callback listener for a loopback URL, starts Google OAuth with the browser
Supabase client, exchanges the returned code in that same client, and sends the
resulting access token to `/api/auth/desktop-session` as a Bearer token.

## Supabase redirect URL

Add this redirect URL to Supabase Auth URL Configuration:

```text
http://127.0.0.1:*/callback*
```

The first `*` covers the ephemeral port. The second covers only the one-time
`?state=...` query that the desktop client adds to the loopback redirect; the
Rust route remains `/callback`. Keep the production public site URL configured
separately. The desktop callback is HTTP because it is loopback-only and the
Rust listener binds only to `127.0.0.1`.

## Desktop build configuration

Set `DSPEAK_PUBLIC_ORIGIN` and set `VITE_DSPEAK_API_PATH` when the API origin differs,
and `SUPABASE_URL`/`SUPABASE_ANON_KEY` for the generated desktop runtime
configuration. Desktop builds fail if the Supabase values are missing. The
build generates a Tauri capability file scoped to the configured dSpeak API,
legal URLs, and Supabase Auth URL.

Tagged releases require these repository secrets:

- `DSPEAK_TAURI_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when the private key is encrypted
- `SUPABASE_ANON_KEY`

Set `SUPABASE_URL` and `DSPEAK_PUBLIC_ORIGIN` as repository variables, or store
`SUPABASE_URL` as a secret instead. The anon key is safe to embed in a client
but must still be supplied to the desktop build; the service-role key must
never be supplied.

Tagged release builds fail if signed updater artifacts or `latest.json` are
missing. Manual and development builds do not claim updater support when the
public key is unavailable.
