# DSpeak

DSpeak is a self-hosted communication platform for text chat, presence, voice,
video, screen sharing, soundboards, and notifications. It runs as one long-lived
Nuxt and Nitro application. PocketBase stores persistent data; native WebRTC and
mediasoup carry realtime media.

## What DSpeak provides

- Rooms with text, voice, camera, screen sharing, and shared audio
- Room roles, branding, media policies, notifications, and member nicknames
- Protected room soundboards and personal system-sound settings
- Direct WebRTC for two participants and optional mesh for three or four
- Automatic mediasoup SFU routing when direct media is unavailable or unsafe
- IPv6-first SFU connectivity with Playit IPv4 and TURN fallbacks
- RTC diagnostics, health checks, and Prometheus-compatible metrics
- Same-origin HTTP and WebSocket endpoints by default

## Runtime architecture

DSpeak is a Nuxt 4 monolith:

| Layer            | Responsibility                                                        |
| ---------------- | --------------------------------------------------------------------- |
| `app/`           | Vue interface, Pinia state, browser capture, and media playback       |
| `server/routes/` | Nitro HTTP and WebSocket endpoints                                    |
| `server/utils/`  | PocketBase access, authorization, migrations, and media orchestration |
| PocketBase       | Persistent users, rooms, messages, policies, and notifications        |
| mediasoup        | Process-owned SFU workers, routers, transports, and RTP forwarding    |

The application must run as a persistent Node.js process. Serverless and edge
runtimes are unsupported because WebSockets and mediasoup resources live in
process memory. Run one application instance unless a distributed signaling
backplane and mediasoup router piping have been implemented.

## Media routing

Every call starts on the SFU so participants have a reliable media path. DSpeak
may then move the whole room to a verified direct route without restarting local
capture.

| Participants | Preferred stable route                                  |
| ------------ | ------------------------------------------------------- |
| 1            | mediasoup SFU                                           |
| 2            | Direct WebRTC after qualification                       |
| 3–4          | SFU, with a full mesh upgrade when every edge qualifies |
| 5 or more    | mediasoup SFU                                           |

The current route remains active until every client confirms the replacement.
Membership changes and unhealthy direct connections return the room to the SFU.
See [Hybrid media topology](docs/hybrid-media-topology.md) for timing, health,
handoff, bitrate, and recovery details.

## Requirements

- Bun for installation, development, testing, and builds
- Node.js 24 for the production server
- PocketBase with an administrator account available to Nitro
- FFmpeg and ffprobe when running outside Docker
- A public IPv4 or IPv6 route for production WebRTC traffic

Docker includes FFmpeg and ffprobe. A non-container host must provide both tools
on `PATH` for soundboard conversion.

## Local development

```bash
cp .env.example .env
bun install
bun run dev
```

The development server listens on `http://localhost:3000`.

At minimum, configure the authentication service and PocketBase connection:

```dotenv
AUTH_PATH=https://api.example.com/auth
POCKETBASE_URL=https://pocketbase.example.com
PBASE_ADMIN_EMAIL=admin@example.com
PBASE_ADMIN_PASSWORD=replace-this-value
```

Nitro applies pending PocketBase migrations during startup. A migration failure
stops the application so it cannot run against a partially updated schema.

## Production build

```bash
bun install --frozen-lockfile
bun run test
bun run build
bun run start
```

`bun run start` loads `.env` and starts `.output/server/index.mjs`. The default
container setup exposes Nitro on host port `31100` and mediasoup on TCP and UDP
port `40000`.

For the complete Coolify, Docker Compose, DNS, firewall, Playit, and TURN setup,
follow the [deployment runbook](docs/deployment.md). Do not expose a production
instance until the runbook's external connectivity checks pass.

## Operational endpoints

| Path                   | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `/health`              | Application and configured TURN health         |
| `/metrics`             | Prometheus-compatible media metrics            |
| `/socket`              | Media signaling WebSocket                      |
| `/dspeak/presence`     | Presence WebSocket                             |
| `/dspeak/chat/socket`  | Realtime chat WebSocket                        |
| `/dspeak/room/*`       | Room management                                |
| `/dspeak/channel/*`    | Text and media channels                        |
| `/dspeak/chat/*`       | Messages, read state, and push subscriptions   |
| `/dspeak/soundboard/*` | Protected room soundboard operations and media |

Optional `DSPEAK_API_URL`, `DSPEAK_WS_URL`, and `DSPEAK_SFU_URL` overrides exist
for split routing. Leave them empty for the supported same-origin monolith.

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
curl --fail https://app.example.com/metrics
```

Media releases also require the real-browser and external-network checks in
[Hybrid media topology](docs/hybrid-media-topology.md) and
[Deployment](docs/deployment.md). Unit tests cannot prove browser ICE behavior,
hardware capture, firewall rules, or public IPv4 and IPv6 reachability.

## Security boundaries

- PocketBase administrator credentials remain server-only.
- Nitro validates authentication, room membership, and authorization.
- Soundboard files and icons are served through membership-protected endpoints.
- WebSocket messages are authenticated and validated before changing state.
- VAPID private keys and TURN shared secrets must never reach the browser.
- The RTC hostname must be DNS-only; an HTTP proxy cannot carry mediasoup RTP.

## Documentation

- [Deployment runbook](docs/deployment.md)
- [Hybrid media topology](docs/hybrid-media-topology.md)
- [Room administration contract](docs/room-administration.md)
- [Room soundboards and system sounds](docs/soundboards.md)
- [Microphone gate](docs/microphone-gate.md)
- [Screen-share audio](docs/screen-share-audio.md)
- [Backend migration](docs/backend-migration.md)
