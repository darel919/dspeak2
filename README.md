# dSpeak

dSpeak is a communication platform for text chat, presence, voice, video, screen sharing, soundboards, and notifications. It runs as a Nuxt 4 + Nitro application **optimized for serverless deployment** on Vercel with persistent media control on Cloudflare Workers/Durable Objects ([dspeak-media-control](https://github.com/darel919/dspeak-media-control)).

The same interface is also shipped as a Tauri desktop client for macOS, Linux, and Windows. The desktop app renders the Nuxt frontend in a WebView and replaces browser capture and playback with a native C++ media engine (libwebrtc and libmediasoupclient).

## License

dSpeak is free software released under the [GNU Affero General Public License version 3 (AGPL-3.0)](LICENSE). You can use, modify, and distribute it under the terms of that license.

If you modify dSpeak and run a modified version on a publicly accessible network service, you must make the modified source code available to all users who interact with it, as required by section 13 of the AGPL-3.0.

## What dSpeak provides

- Rooms with text, voice, camera, screen sharing, and shared audio
- Native desktop apps for macOS, Linux, and Windows (Tauri) with a C++ media engine for capture, SFU, P2P, and playback
- Room roles, branding, media policies, notifications, and member nicknames
- Protected room soundboards and personal system-sound settings
- **Connection modes:** `Auto` (system chooses best route) or `Direct` (P2P only, no relay/SFU fallback)
- **Auto routing:** direct P2P, P2P via TURN relay, Cloudflare Realtime SFU
- IPv6-first media with Cloudflare TURN and optional self-hosted Coturn/Playit fallbacks
- RTC diagnostics, health checks, and Prometheus-compatible metrics
- DJ mode for shared audio broadcasting with room-level attenuation

### Self-hosted media fallback

- Self-hosted mediasoup runs as a separate `dspeak-sfu` service (independent failure domain)
- Deployed independently (Coolify, Docker, bare metal) on fixed port 40000
- Communicates via signed short-lived provider tickets — no shared database or process

## Runtime architecture

| Layer                      | Responsibility                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `app/`                     | Vue interface, Pinia state, browser capture, and media playback                       |
| `server/routes/`           | Nitro HTTP endpoints (Vercel)                                                         |
| `server/utils/`            | Reusable server logic, authorization, media bootstrap                                 |
| `server/db/`               | Drizzle ORM, PostgreSQL schema, repositories (Supabase)                               |
| `server/auth/`             | Supabase Auth (Google OAuth only), JWT verification                                   |
| `server/storage/`          | Cloudflare R2 file storage abstraction                                                |
| `../dspeak-media-control/` | Separate Cloudflare Worker + Durable Objects checkout (media control plane, topology) |
| `desktop/`                 | Tauri 2 shell, Rust commands, and the `libdspeak_media` C++ shim                      |
| `dspeak-sfu/`              | **Separate project:** ElysiaJS + mediasoup SFU provider (self-hosted fallback)        |
| Supabase                   | Auth (Google OAuth), PostgreSQL, Realtime (app events only)                           |
| Cloudflare                 | R2 (files), Durable Objects (media control), Realtime SFU/TURN, Workers               |

The web application runs on Vercel (serverless-optimized). Persistent media control lives on Cloudflare Workers/Durable Objects with WebSocket hibernation. The self-hosted mediasoup provider is a fully independent `dspeak-sfu` project that can be deployed separately (Coolify, Docker, etc.) and communicates via signed short-lived provider tickets — no shared database or process.

The desktop client (`desktop/`) renders the same Nuxt interface in a Tauri WebView. Rust (`desktop/src-tauri/`) owns the window lifecycle, deep links, notifications, autostart, global shortcuts, and auto-updates. A prebuilt native media bundle (`NATIVE_MEDIA_ARTIFACT_DIR`) supplies capture, SFU, P2P, and playback instead of browser WebRTC. See the [native media build boundary](desktop/native-media/README.md).

## Media routing

Two user-facing connection modes:

- **Auto (default):** System selects the best viable route per room — direct P2P, P2P via Cloudflare TURN relay, Cloudflare Realtime SFU. Route selection minimizes the worst participant's practical voice experience (latency, jitter, packet loss). Self-hosted mediasoup is available as an optional fallback (see [Self-hosted media fallback](#self-hosted-media-fallback)).
- **Direct:** Force native/direct P2P only. STUN allowed. TURN relay, Cloudflare SFU, and mediasoup explicitly disabled. If any required direct pair cannot connect, a clear connection error is shown.

Participant limits:

| Scenario                 | Max participants |
| ------------------------ | ---------------- |
| Direct P2P audio only    | 8                |
| Direct P2P with video    | 4                |
| Auto (P2P, TURN, or SFU) | 100              |

Auto mode uses direct P2P only when the current media mix is eligible for a mesh; otherwise it moves to TURN or an SFU route within the 100-participant channel ceiling.

The authoritative media topology coordinator is a **Cloudflare Durable Object per channel** (`MediaRoomDO`). It owns live participant membership, active route/epoch, P2P signaling relay, provider health, and route commit state. Supabase Realtime handles normal app events (chat, typing, notifications) only — never media topology.

## Requirements

- Bun for installation, development, testing, and builds
- Node.js 22+ for the production server
- Rust stable toolchain with the Tauri CLI to build the desktop client
- Native media build tools and a first-run bundle provision for desktop development
- Supabase project (PostgreSQL, Auth, Realtime)
- Cloudflare account (Workers, Durable Objects, R2, Realtime SFU/TURN)
- The sibling [`dspeak-media-control`](https://github.com/darel919/dspeak-media-control) checkout for media control WebSockets and Durable Objects
- FFmpeg and ffprobe when running outside Docker

Docker includes FFmpeg and ffprobe. A non-container host must provide both tools on `PATH` for soundboard conversion.

Desktop builds need Rust and a complete native media bundle. `dev:desktop` provisions the ignored local bundle automatically on first run; production builds still consume a prebuilt bundle and never download dependencies at application startup. See [desktop/native-media/README.md](desktop/native-media/README.md).

## Local development

```bash
cp .env.example .env
bun install
bun run dev
```

The development server listens on `http://localhost:3000`.

### Desktop client

```bash
cp desktop/native-media/dependencies.env.example desktop/native-media/dependencies.env
bun run dev:desktop
```

`dev:desktop` loads `desktop/native-media/dependencies.env`, provisions and validates a complete native media bundle when the ignored directory is empty, and launches the Tauri shell against the dev server. The web application keeps using browser WebRTC and does not require the bundle. See the [native media build boundary](desktop/native-media/README.md).

### Environment variables (web/API)

```dotenv
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:6543/postgres?pgbouncer=true
DIRECT_DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres

# Cloudflare
CF_MEDIA_CONTROL_URL=https://media-control.example.com
CF_MEDIA_CONTROL_ISSUER=dspeak-media-control
CF_MEDIA_CONTROL_ADMIN_TOKEN=long-random-secret
CF_MEDIA_TICKET_PRIVATE_KEY=base64-encoded-ed25519-pkcs8-private-key
CF_R2_ACCOUNT_ID=your-account-id
CF_R2_ACCESS_KEY_ID=your-r2-access-key
CF_R2_SECRET_ACCESS_KEY=your-r2-secret-key
CF_R2_BUCKET_NAME=dspeak

# TURN
DSPEAK_RTC_DOMAIN=rtc.example.com
TURN_PORT=3478
TURN_TLS_PORT=5349
TURN_SHARED_SECRET=long-random-secret
TURN_CREDENTIAL_TTL_SECONDS=900

CF_TURN_APP_ID=cloudflare-turn-app-id
CF_TURN_API_KEY=cloudflare-turn-api-key
CF_TURN_CREDENTIAL_TTL_SECONDS=86400
```

`DATABASE_URL` uses Supavisor transaction mode (port 6543) for Vercel/serverless. `DIRECT_DATABASE_URL` is for migrations/admin (port 5432).

### Environment variables (dspeak-sfu)

See `dspeak-sfu/.env.example` in the sibling project.

### Related service checkouts

The main `bun install` does not install or run the media control Worker. Voice sessions require `dspeak-media-control` to be checked out and deployed separately. The optional self-hosted provider is a third independent checkout.

```bash
cd ..
git clone <dspeak-media-control-repository-url> dspeak-media-control
git clone <dspeak-sfu-repository-url> dspeak-sfu

cd dspeak-media-control
npm install
cp .env.example .dev.vars
# edit .dev.vars, then configure Cloudflare secrets with wrangler
npm test
npm run dev
```

For production, deploy the Worker with `npm run deploy` after setting its Durable Object bindings and secrets. Deploy `dspeak-sfu` separately only when self-hosted mediasoup fallback is enabled; its setup is documented in that checkout's `README.md` and `docs/deployment.md`.

## Production build

```bash
bun install --frozen-lockfile
bun run test
bun run build
bun run start
```

`bun run start` loads `.env` and starts `.output/server/index.mjs`.

### Deploy targets

| Component        | Platform                             | Notes                                              |
| ---------------- | ------------------------------------ | -------------------------------------------------- |
| Web/API (Nuxt)   | Vercel                               | Serverless, no persistent WebSockets               |
| Media control    | Cloudflare Workers + Durable Objects | Hibernating WebSockets, SQLite-backed DOs          |
| File storage     | Cloudflare R2                        | Direct-to-R2 uploads, signed URLs                  |
| Auth/DB/Realtime | Supabase                             | Google OAuth only, PostgreSQL, private channels    |
| Self-hosted SFU  | Coolify / Docker / bare metal        | Independent `dspeak-sfu` project, fixed port 40000 |

### Serverless optimization

The web application is designed for serverless deployment on Vercel:

- No persistent WebSocket connections in the Nuxt/Nitro layer
- All persistent state (media control WebSockets, presence) lives in Cloudflare Durable Objects and Supabase Realtime
- Database connections use Supavisor transaction pooling (port 6543) for serverless compatibility
- Short-lived media tickets (60-120s) eliminate the need for long-lived auth state
- Cold-start optimized: minimal dependencies, lazy-loaded media bootstrap, no background workers in the web process

For the complete Coolify, Docker Compose, DNS, firewall, and TURN setup, follow the [deployment runbook](docs/deployment.md). Do not expose a production instance until the runbook's external connectivity checks pass.

### Desktop client

```bash
bun run build:desktop
```

Builds the Tauri app for the host platform. Version-tagged releases are built for macOS, Linux, and Windows by the [desktop CI build](docs/native-media/ci-desktop-build.md), which publishes the installers to a GitHub Release; installed clients update through the updater endpoint configured in `desktop/src-tauri/tauri.conf.json`.

Every web and desktop build embeds its package version, source commit, source branch, repository, and build time. The public `/api/update` endpoint compares that identity with `DSPEAK_UPDATE_BRANCH` and returns the pending commits and changed files. Set `DSPEAK_UPDATE_REPOSITORY` and `DSPEAK_UPDATE_BRANCH` when the deployed app tracks a repository or branch other than the defaults in `.env.example`. `DSPEAK_GITHUB_TOKEN` is optional and must remain server-only; it raises the GitHub API quota for private or high-traffic deployments.

## Operational endpoints

| Path                   | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `/health`              | Application health                                  |
| `/metrics`             | Bearer-protected Prometheus metrics                 |
| `/api/update`          | Public commit and pending-change comparison         |
| `/api/media/bootstrap` | Media join bootstrap (issues short-lived ticket)    |
| `/api/files/prepare`   | Prepare direct-to-R2 upload                         |
| `/api/files/commit`    | Commit upload, record metadata                      |
| `/api/presence`        | Presence status snapshot, update, activity, offline |
| `/api/chat/*`          | Messages, read state, push subscriptions            |
| `/api/room/*`          | Room management                                     |
| `/api/channel/*`       | Text and media channels                             |
| `/api/soundboard/*`    | Protected room soundboard operations and media      |
| `/api/dj/*`            | DJ session management                               |

Realtime application events (chat messages, presence, voice presence, room and profile updates, notifications) are delivered over Supabase Realtime, not Nitro WebSockets. Clients subscribe to reserved topics `global`, `chat:<channelId>`, `room:<roomId>`, and `notify:<userId>` with their Supabase access token; the server publishes with the service role. Client writes are limited to the `chat:%` topic by row-level security. Presence status and channel join/leave are persisted through the `/api/presence` and `/api/channel/join|leave` endpoints.

Media control WebSocket: `wss://media-control.example.com/media-control/<channelId>` (per-channel Durable Object)

Self-hosted mediasoup SFU: `wss://sfu.example.com/v1/ws` (separate `dspeak-sfu` deployment)

Protected application APIs and WebSockets use Supabase access tokens (validated locally via JWKS). Session cookies are not used for media control.

## Verification

Run the repository gates before release:

```bash
bun run format
bun run format:check
bun run test
bun run build
```

After deployment, verify the production process and its public routes:

```bash
curl --fail https://app.example.com/health
curl --fail -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://app.example.com/api/media/bootstrap \
  -d '{"channelId":"...","roomId":"..."}'
```

Media releases also require the real-browser and external-network checks in [Hybrid media topology](docs/hybrid-media-topology.md) and [Deployment](docs/deployment.md). Unit tests cannot prove browser ICE behavior, hardware capture, firewall rules, or public IPv4 and IPv6 reachability.

## Security boundaries

- Supabase Auth: Google OAuth only (scopes: openid, email, profile). Email/password, magic links, phone, anonymous disabled.
- Asymmetric JWT verification (ES256 preferred) for all API authorization — no per-request Supabase Auth calls.
- Short-lived media tickets (60-120s) signed by dSpeak, verified by Cloudflare DO and `dspeak-sfu` locally.
- R2: no permanent write credentials in client; short-lived signed upload URLs; random object IDs.
- VAPID private keys, TURN shared secrets, Cloudflare app secrets must never reach the browser.
- The self-hosted SFU RTC hostname must be DNS-only; an HTTP proxy cannot carry mediasoup RTP.
- RLS enabled on all client-observable Supabase tables and Realtime topics.

## Documentation

- [Deployment runbook](docs/deployment.md)
- [Desktop CI build runbook](docs/native-media/ci-desktop-build.md)
- [Native media build boundary](desktop/native-media/README.md)
- [Hybrid media topology](docs/hybrid-media-topology.md)
- [Room administration contract](docs/room-administration.md)
- [Chat cache and room switching](docs/chat-cache.md)
- [Room soundboards and system sounds](docs/soundboards.md)
- [Microphone gate](docs/microphone-gate.md)
- [Voice controls](docs/voice-controls.md)
- [Screen-share audio](docs/screen-share-audio.md)
- [Backend migration](docs/backend-migration.md)
- [DJ mode](docs/dj-mode.md)
- [Production readiness](docs/production-readiness.md)
- [Content security policy](docs/content-security-policy.md)
- [Desktop auth](docs/desktop-auth.md)
- [Direct messages](docs/direct-messages.md)
- [Web threat mitigation](docs/web-threat-mitigation.md)
- [Client performance](docs/client-performance.md)
- [Media tickets](docs/media-tickets.md)
- [Native worker fatal recovery](docs/native-media/native-worker-fatal-recovery.md)
- [Media entry points inventory](docs/native-media/media-entry-points-inventory.md)
