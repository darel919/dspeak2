# Desktop authentication and update configuration

The packaged Tauri client owns its Supabase PKCE session. It asks the native
callback listener for a loopback URL, starts Google OAuth with the browser
Supabase client, exchanges the returned code in that same client, and sends the
resulting access token to `/api/auth/desktop-session` as a Bearer token.

Supabase returns a `flowId` with the desktop `signInWithOAuth` result. dSpeak
stores that selector and its own callback `state` in local storage for the
short-lived OAuth attempt, then passes `{ flowId }` to
`exchangeCodeForSession`. Both values are cleared when an attempt completes,
fails, is cancelled, or expires. The callback page shown by the browser only
confirms that Rust received the redirect; it does not confirm the PKCE exchange
or the dSpeak session bridge.

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
legal URLs, and Supabase Auth URL. The checked-in default capability also keeps
the production dSpeak API and legal URL scopes available when the generated
capability has not yet been produced.

Desktop diagnostics use separate stage markers for callback receipt, state
validation, PKCE exchange, and the dSpeak API session bridge. They report only
whether a flow selector exists, safe Supabase error metadata, HTTP status, and
server diagnostic category; authorization codes, verifiers, and tokens are not
logged.

The session bridge responses carry two non-secret fingerprint headers:

- `X-dSpeak-Build-Commit` — server build commit
- `X-dSpeak-Supabase-Project` — Supabase project ref (e.g. `crmucqnebwlssqzthnek`)

## Production edge and WAF requirements

The release workflow runs a no-secret same-origin POST to
`/api/auth/desktop-session` through `DSPEAK_PUBLIC_ORIGIN` before it builds the
desktop installers. The request has no bearer token. A healthy deployment
returns HTTP 401 with an `application/json` body whose `statusMessage` is
`DESKTOP_SESSION_MISSING_BEARER`.

The response must include both `X-dSpeak-Build-Commit` and
`X-dSpeak-Supabase-Project`. The smoke rejects a redirect, a 429 response, a
Vercel challenge, an HTML response, a non-application response, or a missing
fingerprint. It uses manual redirect handling and prints only the public
origin, HTTP status, diagnostic category, build commit, and Supabase project
ref.

Configure the production edge and WAF so this exact same-origin POST reaches
Nitro. The edge must preserve the POST method, the application 401 status, the
JSON content type, and both dSpeak fingerprint headers. Do not put a bearer
token in the edge probe. Do not replace the application response with a bot
challenge, an interactive Vercel challenge, an HTML error page, a redirect, or
a rate-limit response. Keep the endpoint's application authentication in
Nitro. The edge must not require a user token before Nitro can return the
expected missing-bearer diagnostic.

If the smoke fails, stop the release. Check the deployed commit and Supabase
project fingerprints first. Then check the Vercel route, WAF challenge rules,
rate limits, redirects, and origin forwarding. Restore the edge path and rerun
`node scripts/desktop-session-edge-smoke.mjs` before rebuilding. Do not fix an
edge failure by weakening the bearer check or by adding a secret to the smoke.

The authenticated workflow job is optional. It runs only when the GitHub
Actions secret `DSPEAK_TEST_TOKEN` exists. The job passes the token through its
environment and runs exactly three session-bridge calls. It does not print the
token, response bodies, authorization headers, or assertion data derived from
them. `DSPEAK_TEST_TOKEN_OTHER_PROJECT` adds the cross-project rejection case;
without it, the second call repeats the valid session with a new device id.

When the client's configured Supabase project differs from the server's, the
client reports `DESKTOP_SUPABASE_PROJECT_MISMATCH` instead of the generic
bridge error. The server also emits `DESKTOP_SUPABASE_PROJECT_MISMATCH` when
the token issuer project ref differs from the configured one, and
`DESKTOP_ACCOUNT_EMAIL_IDENTITY_CONFLICT` (HTTP 409) when a verified email
already belongs to a different dSpeak user id.

A public diagnostics endpoint reports only non-secret configuration state:

```text
GET /api/diagnostics/auth-config
```

It returns the build commit, Supabase project ref, and booleans for whether
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`DATABASE_URL` are configured. It does not probe the database and never
returns keys, tokens, or connection strings.

## Email identity conflict policy

A verified email maps to exactly one dSpeak account. When a Supabase OAuth
identity presents an email that already belongs to a different dSpeak user id
(the historical `users.id` / `users.email` divergence case), provisioning does
**not** rewrite primary keys. It returns HTTP 409 with
`DESKTOP_ACCOUNT_EMAIL_IDENTITY_CONFLICT`, which the desktop surfaces as an
actionable diagnostic.

Repair is a deliberate, one-off database decision by an administrator (link the
new Supabase UUID to the existing account, or re-create the old identity),
because user ids are foreign-key referenced throughout the schema. Automatic
migration is intentionally not implemented.

Conflict classification uses the PostgreSQL unique-violation SQLSTATE `23505`
plus the constraint name (`users_email_unique`, `users_username_unique`,
`profiles_username_unique`). If a historical migration renamed a constraint,
run:

```sql
select conname from pg_constraint where conrelid = 'users'::regclass;
```

and update `server/db/repositories/profiles.ts` accordingly.

Before release, verify the environment fingerprints match:

```bash
node scripts/verify-auth-environment.mjs
```

It prints the API origin, public origin, Supabase project ref, and normalized
Supabase URL — never keys. Desktop and server must report the same project ref.

Run the edge smoke from a trusted environment after deployment:

```bash
DSPEAK_PUBLIC_ORIGIN=https://app.example.com \
node scripts/desktop-session-edge-smoke.mjs
```

The missing-bearer response is a successful edge check. It does not establish
that a user can complete OAuth or that the session cookie can be persisted.

## Desktop authentication recovery

The desktop client treats callback receipt, OAuth state validation, PKCE code
exchange, and the dSpeak session bridge as separate stages. A browser callback
page only proves that Rust received the redirect. It does not prove that the
PKCE exchange or the session bridge succeeded.

When a stage fails, the client clears the one-time OAuth selector and callback
state. A new sign-in starts a new OAuth attempt. The client does not fall back
to WebView WebRTC or an unauthenticated desktop session. It reports the stage,
HTTP status, server diagnostic category, request id, and safe deployment
fingerprints without logging authorization codes, verifiers, access tokens, or
refresh tokens.

`DESKTOP_SESSION_MISSING_BEARER` is the expected diagnostic only for the
no-secret edge smoke. An authenticated desktop request must use the configured
Supabase project. A project mismatch, invalid token, profile provisioning
failure, or email identity conflict remains an application failure and must be
repaired at its owning boundary. A verified email identity conflict returns
HTTP 409 and requires an administrator to make the one-off account decision;
the client must not rewrite user ids or retry it as a transport failure.

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
