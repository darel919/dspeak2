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
4. Set this application's `MEDIA_CONTROL_URL` and matching media-ticket private key.
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
wrangler secret put PROVIDER_TICKET_PUBLIC_KEY
wrangler secret put MEDIA_CONTROL_ADMIN_TOKEN
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
DSPEAK_GITHUB_TOKEN=<optional-server-only-token>

SUPABASE_URL=https://project-ref.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
DATABASE_URL=postgresql://postgres:<password>@db.example.com:5432/postgres

MEDIA_CONTROL_URL=https://media-control.example.com
MEDIA_CONTROL_ISSUER=dspeak-media-control
MEDIA_CONTROL_ADMIN_TOKEN=<long-random-secret>
MEDIA_TICKET_PRIVATE_KEY=<base64-encoded-Ed25519-PKCS8-private-key>

R2_ACCOUNT_ID=<account-id>
R2_ACCESS_KEY_ID=<access-key-id>
R2_SECRET_ACCESS_KEY=<secret-access-key>
R2_BUCKET_NAME=dspeak

CLOUDFLARE_TURN_KEY_ID=<turn-key-id>
CLOUDFLARE_TURN_API_TOKEN=<turn-api-token>
CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS=86400

DSPEAK_SFU_HTTP_URL=https://sfu.example.com
DSPEAK_SFU_METRICS_TOKEN=<provider-metrics-token>
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

Schedule authenticated cleanup and reconciliation calls with `DSPEAK_CRON_SECRET` so abandoned uploads and unreferenced objects are removed. Database metadata is the authorization source; R2 stores bytes only.

## Media control, Realtime, and TURN

Deploy `dspeak-media-control` as a separate Cloudflare Worker with a Durable Object namespace. Configure its media-ticket public key to match this application's `MEDIA_TICKET_PRIVATE_KEY`, and configure its own independent provider-ticket keypair for communication with media providers.

If the optional self-hosted provider is enabled, replace the example
`DSPEAK_SFU_SIGNALING_URL` in the Worker configuration with the real `wss://`
endpoint before deploying and register the provider through the authenticated
registry endpoint.

The browser flow is:

1. Call `POST /api/media/bootstrap` with a Supabase bearer token.
2. Receive a two-minute media ticket and the media-control URL.
3. Connect to `wss://media-control.example.com/room/<channelId>`.
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

## Desktop releases

The Tauri client is distributed separately. A `v*` tag runs the native-media and desktop workflows and publishes platform installers. The desktop WebView connects to the same application, Supabase, and media-control services as the browser. Desktop builds require a complete prebuilt native media bundle; see [Desktop CI build](native-media/ci-desktop-build.md).

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
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when the key is protected. The release job
creates signed updater bundles and `latest.json`; without these secrets it
intentionally refuses to create a release build that claims to support
automatic updates. Existing desktop binaries built before the signing key and
manifest are configured require one manual installer update.

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
