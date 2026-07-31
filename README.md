# dSpeak

dSpeak is a self-hosted communication platform for text chat, presence, voice,
video, screen sharing, soundboards, and notifications. It runs as one long-lived
Nuxt and Nitro application. PocketBase stores persistent data; native WebRTC and
mediasoup carry realtime media.

The same interface is also shipped as a Tauri desktop client for macOS, Linux,
and Windows. The desktop app renders the Nuxt frontend in a WebView and replaces
browser capture and playback with a native C++ media engine (libwebrtc and
libmediasoupclient).

## License

dSpeak is free software released under the
[GNU Affero General Public License version 3 (AGPL-3.0)](LICENSE).
You can use, modify, and distribute it under the terms of that license.

If you modify dSpeak and run a modified version on a publicly accessible
network service, you must make the modified source code available to all users
who interact with it, as required by section 13 of the AGPL-3.0.

## What dSpeak provides

- Rooms with text, voice, camera, screen sharing, and shared audio
- Native desktop apps for macOS, Linux, and Windows (Tauri) with a C++ media
  engine for capture, SFU, P2P, and playback
- Room roles, branding, media policies, notifications, and member nicknames
- Protected room soundboards and personal system-sound settings
- Direct WebRTC for two participants and optional mesh for three or four
- Automatic mediasoup SFU routing when direct media is unavailable or unsafe
- IPv6-first SFU connectivity with Playit IPv4 and TURN fallbacks
- RTC diagnostics, health checks, and Prometheus-compatible metrics
- Same-origin HTTP and WebSocket endpoints by default

## Runtime architecture

dSpeak is a Nuxt 4 monolith:

| Layer            | Responsibility                                                        |
| ---------------- | --------------------------------------------------------------------- |
| `app/`           | Vue interface, Pinia state, browser capture, and media playback       |
| `server/routes/` | Nitro HTTP and WebSocket endpoints                                    |
| `server/utils/`  | PocketBase access, authorization, migrations, and media orchestration |
| `desktop/`       | Tauri 2 shell, Rust commands, and the `libdspeak_media` C++ shim      |
| PocketBase       | Persistent users, rooms, messages, policies, and notifications        |
| mediasoup        | Process-owned SFU workers, routers, transports, and RTP forwarding    |

The application must run as a persistent Node.js process. Serverless and edge
runtimes are unsupported because WebSockets and mediasoup resources live in
process memory. Run one application instance unless a distributed signaling
backplane and mediasoup router piping have been implemented.

The desktop client (`desktop/`) renders the same Nuxt interface in a Tauri
WebView. Rust (`desktop/src-tauri/`) owns the window lifecycle, deep links,
notifications, autostart, global shortcuts, and auto-updates. A prebuilt native
media bundle (libwebrtc, libmediasoupclient, and the `libdspeak_media` shim)
supplies capture, SFU, P2P, and playback instead of browser WebRTC. See the
[native media build boundary](desktop/native-media/README.md).

## Media routing

Every call starts on the SFU so participants have a reliable media path. dSpeak
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
- Rust stable toolchain with the Tauri CLI to build the desktop client
- A prebuilt native media bundle (`NATIVE_MEDIA_ARTIFACT_DIR`) to build the
  desktop client with native WebRTC media
- PocketBase with an administrator account available to Nitro
- FFmpeg and ffprobe when running outside Docker
- A public IPv4 or IPv6 route for production WebRTC traffic

Docker includes FFmpeg and ffprobe. A non-container host must provide both tools
on `PATH` for soundboard conversion.

Desktop builds need Rust and a complete native media bundle. The bundle is
produced by CI or a separate provisioning step and is never downloaded at
runtime; see [desktop/native-media/README.md](desktop/native-media/README.md).

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
# set NATIVE_MEDIA_ARTIFACT_DIR to a complete native media bundle, then:
bun run dev:desktop
```

`dev:desktop` loads `desktop/native-media/dependencies.env`, requires a complete
native media bundle (a missing one is a build error), and launches the Tauri
shell against the dev server. The web application keeps using browser WebRTC and
does not require the bundle. See the
[native media build boundary](desktop/native-media/README.md).

At minimum, configure the authentication service and PocketBase connection:

```dotenv
AUTH_PATH=https://api.example.com/auth
DSPEAK_PUBLIC_ORIGIN=https://app.example.com
DSPEAK_METRICS_TOKEN=replace-with-a-long-random-secret
POCKETBASE_URL=https://pocketbase.example.com
PBASE_ADMIN_EMAIL=admin@example.com
PBASE_ADMIN_PASSWORD=replace-this-value
```

`AUTH_PATH` is server-only and must expose the DWS one-time handoff endpoints.
`DSPEAK_PUBLIC_ORIGIN` must be the exact browser origin; the generated
authentication callback is `<DSPEAK_PUBLIC_ORIGIN>/auth`.

Nitro applies pending PocketBase migrations during startup. A migration failure
stops the application so it cannot run against a partially updated schema.
The initializer can prepare a fresh PocketBase instance and repairs a missing
required collection on a later startup. See the
[database design](docs/database-design.md) for the collection model and
initialization contract.

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

### Desktop client

```bash
bun run build:desktop
```

builds the Tauri app for the host platform. Version-tagged releases are built
for macOS, Linux, and Windows by the
[desktop CI build](docs/native-media/ci-desktop-build.md), which publishes the
installers to a GitHub Release; installed clients update through the updater
endpoint configured in `desktop/src-tauri/tauri.conf.json`.

## Operational endpoints

| Path                | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `/health`           | Application and configured TURN health         |
| `/metrics`          | Bearer-protected Prometheus media metrics      |
| `/socket`           | Media signaling WebSocket                      |
| `/api/presence`     | Presence WebSocket                             |
| `/api/chat/socket`  | Realtime chat WebSocket                        |
| `/api/room/*`       | Room management                                |
| `/api/channel/*`    | Text and media channels                        |
| `/api/chat/*`       | Messages, read state, and push subscriptions   |
| `/api/soundboard/*` | Protected room soundboard operations and media |

Protected application APIs and WebSockets are same-origin so the server-owned
HttpOnly session is used consistently. Follow the
[production readiness gate](docs/production-readiness.md) before release.

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
curl --fail -H "Authorization: Bearer $DSPEAK_METRICS_TOKEN" \
  https://app.example.com/metrics
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
