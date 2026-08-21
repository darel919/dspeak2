# Deployment runbook

This runbook describes the current production layout: Nuxt/Nitro on Vercel, Supabase PostgreSQL/Auth/Realtime, Cloudflare R2, the external `dspeak-media-control` Worker, Cloudflare Realtime/TURN, and an optional standalone `dspeak-sfu` provider.

## Deployment model

| Component                    | Platform                            | Persistent responsibility                                   |
| ---------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| Web and HTTP API             | Vercel                              | None; serverless-compatible Nitro handlers                  |
| Auth, database, app realtime | Supabase                            | Google OAuth, PostgreSQL, chat/presence/notification events |
| Object storage               | Cloudflare R2                       | Upload bytes and protected media assets                     |
| Media control                | Cloudflare Worker + Durable Objects | Per-channel WebSocket, topology, signaling, provider health |
| Managed media                | Cloudflare Realtime + TURN          | SFU forwarding and relay candidates                         |
| Optional self-hosted media   | Standalone `dspeak-sfu`             | Independent mediasoup provider                              |

Do not run mediasoup inside the main application container or Vercel function. Do not route media topology through Supabase Realtime. The Worker Durable Object is the authoritative owner of live media state.

## Service setup order

These are separate deployments, not one shared application dependency tree:

1. Create Supabase and apply the checked-in Drizzle migrations with `npx drizzle-kit migrate` using `DIRECT_DATABASE_URL`.
2. Install and configure this Nuxt application with `bun install`.
3. Check out `dspeak-media-control` beside this repository, run `npm install`, configure `.dev.vars` and Wrangler secrets, then deploy its Worker and Durable Object bindings.
4. Set this application's `CF_MEDIA_CONTROL_URL` and matching media-ticket private key.
5. Configure Cloudflare R2 and Realtime/TURN.
6. Deploy the optional `dspeak-sfu` checkout separately when self-hosted fallback is enabled.

`dspeak-media-control` is not installed by the main application's Bun
dependencies. Its setup and tests are run from its own checkout:

```bash
cd ../dspeak-media-control
npm install
cp .env.example .dev.vars
npm test
npm run deploy
```

Set these Worker secrets with Wrangler before deployment:

```bash
wrangler secret put MEDIA_TICKET_PUBLIC_KEY
wrangler secret put PROVIDER_TICKET_PRIVATE_KEY
wrangler secret put MEDIA_CONTROL_ADMIN_TOKEN
wrangler secret put CLOUDFLARE_REALTIME_APP_SECRET
```

The main app and Worker share the media-ticket keypair: the app keeps the
private key and the Worker keeps the public key. The Worker and optional
`dspeak-sfu` use a separate provider-ticket keypair. See [Media tickets](media-tickets.md).

## Required application configuration

Use `.env.example` as the canonical inventory. At minimum, configure:

```dotenv
DSPEAK_PUBLIC_ORIGIN=https://app.example.com
DSPEAK_METRICS_TOKEN=<long-random-secret>
DSPEAK_CSRF_SECRET=<at-least-32-random-characters>
DSPEAK_CRON_SECRET=<long-random-secret>
DSPEAK_UPDATE_REPOSITORY=darel919/dspeak2
DSPEAK_UPDATE_BRANCH=next

SUPABASE_URL=https://project-ref.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
DATABASE_URL=postgresql://postgres:<password>@db.example.com:5432/postgres

CF_MEDIA_CONTROL_URL=https://media-control.example.com
CF_MEDIA_CONTROL_ISSUER=dspeak-media-control
CF_MEDIA_CONTROL_ADMIN_TOKEN=<long-random-secret>
CF_MEDIA_TICKET_PRIVATE_KEY=<base64-encoded-Ed25519-PKCS8-private-key>

CF_R2_ACCOUNT_ID=<account-id>
CF_R2_ACCESS_KEY_ID=<access-key-id>
CF_R2_SECRET_ACCESS_KEY=<secret-access-key>
CF_R2_BUCKET_NAME=dspeak

DSPEAK_RTC_DOMAIN=rtc.example.com
TURN_PORT=3478
TURN_TLS_PORT=5349
TURN_SHARED_SECRET=<long-random-secret>
TURN_CREDENTIAL_TTL_SECONDS=900

CF_TURN_APP_ID=<cloudflare-turn-app-id>
CF_TURN_API_KEY=<cloudflare-turn-api-key>
CF_TURN_CREDENTIAL_TTL_SECONDS=86400
```

The Supabase service-role key, database URL, media ticket private key, media-control admin token, R2 secret, TURN token, metrics tokens, and VAPID private key must remain server-only. Use only the Supabase anon key in browser configuration.

Generate the media ticket keypair once and install its private half in this app and public half in `dspeak-media-control`. Do not reuse the control-plane provider-ticket keypair. See [Media tickets](media-tickets.md).

## Supabase

1. Create the Supabase project and configure Google as the only enabled sign-in provider.
2. Add `https://app.example.com/auth` to the allowed redirect URLs.
3. Apply the checked-in Drizzle migrations from `drizzle/` to PostgreSQL.
4. Enable and verify RLS on every client-observable table.
5. Configure private Realtime channels and authorization policies for chat, typing, presence, and notifications.
6. Confirm JWT signing uses an asymmetric key supported by the application's JWKS verifier.

Back up PostgreSQL before production schema migrations. Apply migrations before directing traffic to a release that depends on them.

## Cloudflare R2

Create a private bucket and scoped credentials for the server. Clients upload through short-lived URLs prepared by `/api/files/prepare`, then commit metadata through `/api/files/commit`. Configure the bucket CORS policy only for `https://app.example.com` and required methods. Do not expose permanent R2 credentials or public bucket URLs.

The browser upload policy must allow `PUT` and `Content-Type` for the deployed web origin. The Tauri client sends presigned `PUT` requests through its native HTTP transport, so `tauri.localhost` does not need to be added to the bucket CORS policy. Set `CF_R2_ACCOUNT_ID` in the desktop build environment so the generated Tauri capability scopes that native transport to the correct R2 endpoint.

Schedule authenticated cleanup and reconciliation calls with `DSPEAK_CRON_SECRET` so abandoned uploads and unreferenced objects are removed. Database metadata is the authorization source; R2 stores bytes only.

## Media control, Realtime, and TURN

Deploy `dspeak-media-control` as a separate Cloudflare Worker with a Durable Object namespace. Configure its media-ticket public key to match this application's `CF_MEDIA_TICKET_PRIVATE_KEY`, and configure its own independent provider-ticket keypair for communication with media providers. The Worker-side secret names, including `MEDIA_TICKET_PUBLIC_KEY` and `MEDIA_CONTROL_ADMIN_TOKEN`, remain part of that Worker checkout's contract.

If the optional self-hosted provider is enabled, replace the example
`DSPEAK_SFU_SIGNALING_URL` in the Worker configuration with the real `wss://`
endpoint before deploying and register the provider through the authenticated
registry endpoint.

The browser flow is:

1. Call `POST /api/media/bootstrap` with a Supabase bearer token.
2. Receive a two-minute media ticket and the media-control URL.
3. Connect to `wss://media-control.example.com/media-control/<channelId>`.
4. Let the Durable Object select direct P2P, Cloudflare TURN, Cloudflare Realtime SFU, or the optional standalone provider.

Configure Cloudflare Realtime and TURN credentials only in the services that need them. Verify direct, relay, and managed-SFU paths from external networks; unit tests cannot prove ICE reachability or hardware media behavior.

## Optional standalone `dspeak-sfu`

Deploy `dspeak-sfu` separately on Docker, Coolify, or bare metal. Follow that project's runbook for its fixed RTC port, announced address, firewall, TLS, metrics, and provider-ticket public key. Its signaling endpoint may use `wss://sfu.example.com/v1/ws`; its RTC hostname must remain DNS-only because an HTTP proxy cannot carry mediasoup RTP.

Register each healthy standalone provider through the authenticated media-control
registry endpoint. The registry route is internal to topology selection; clients
never choose a provider or call the registry directly.

The main app does not use `MEDIASOUP_*` variables. Those settings belong only to the standalone provider deployment.

## Vercel deployment

Build the web/API application with:

```bash
bun install --frozen-lockfile
bun run test
bun run build
```

Set the application variables in Vercel and deploy the generated Nitro output. Persistent media WebSockets do not terminate on Vercel; only HTTP APIs, including media bootstrap, run there.

Vercel Hobby permits cron jobs no more frequently than once per day. The
checked-in Vercel cron therefore runs the push dispatcher daily at 00:00 UTC.
Use a Vercel plan with a more frequent cron allowance or an external scheduler
calling `/api/internal/push-dispatch` with the `DSPEAK_CRON_SECRET` bearer token
when push notifications must be delivered promptly. Persistent deployments
run the in-process dispatcher instead.

## Desktop releases

The Tauri client is distributed separately. A `v*` tag runs the native-media and desktop workflows and publishes platform installers. The desktop WebView connects to the same application, Supabase, and media-control services as the browser. Desktop builds require a complete prebuilt native media bundle; see [Desktop CI build](native-media/ci-desktop-build.md).

The root `package.json` version is canonical for local and manual builds. For automatic releases, the `v*` tag supplies the release version and CI synchronizes `package.json`, the Tauri configuration, Rust package metadata, and both lockfiles immediately after checkout. The build and updater manifest are produced from that exact tagged commit and version.

The application embeds its build commit and checks `/api/update` at startup
and while a client remains visible and online. The endpoint compares the client and deployed commits with
`DSPEAK_UPDATE_REPOSITORY` at `DSPEAK_UPDATE_BRANCH`, then reports the commits
and files that are ahead. A web client only offers a refresh when the deployed
server build is newer. A Tauri client shows repository commits even when a
desktop package has not been published yet.

Tauri package updates require one signing keypair that must never be replaced
after the first public release. Generate it with the Tauri CLI, keep the
private key in the GitHub `TAURI_SIGNING_PRIVATE_KEY` secret, and provide the
matching public key through `DSPEAK_TAURI_PUBLIC_KEY`. The workflow also reads
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when the key is protected. When both keys
are configured, the release job creates signed updater bundles and
`latest.json`. Without the keypair, it still publishes the platform installers
but omits automatic updater artifacts. Existing desktop binaries built before
the signing key and manifest are configured require one manual installer
update.

## Production checks

```bash
curl --fail https://app.example.com/health
curl --fail \
  -H "Authorization: Bearer ${DSPEAK_METRICS_TOKEN}" \
  https://app.example.com/metrics
```

Before release, also verify:

- Google sign-in, refresh, logout, and rejected expired tokens;
- database migration status and RLS denial for unauthorized users;
- direct-to-R2 upload, commit, protected download, cleanup, and reconciliation;
- media bootstrap rejection without membership and success with a valid Supabase token;
- the media-control WebSocket, route epochs, and P2P signaling;
- Cloudflare Realtime SFU and TURN from at least two external networks;
- failure and recovery of the optional `dspeak-sfu` provider without losing control-plane state;
- Web Push delivery and authenticated metrics.

Never treat a successful Vercel deployment alone as proof that Supabase policies, R2 permissions, media providers, TURN, or external network paths work.
