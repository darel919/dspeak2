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
