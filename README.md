# DSpeak

DSpeak is a self-hosted application for rooms, text chat, presence, voice, video,
screen sharing, and system audio. Nuxt serves the browser application and Nitro
backend from one long-running process. PocketBase stores application data, while
native WebRTC and mediasoup carry realtime media.

## Highlights

- Text chat, presence, voice, camera, screen sharing, and shared audio
- Native direct WebRTC for two participants
- Native WebRTC mesh for three or four participants
- Automatic mediasoup SFU fallback for larger or unhealthy rooms
- Seamless, all-client topology handoffs without restarting capture
- IPv6-first SFU routing with an optional Playit IPv4 fallback
- Animated RTC topology and transport diagnostics
- Same-origin HTTP and WebSocket routes by default

## Media routing

DSpeak automatically chooses the lowest-latency reliable route:

| Participants | Route |
| --- | --- |
| 1 | No media transport |
| 2 | Direct P2P |
| 3–4 | Full P2P mesh |
| 5+ or unhealthy mesh | mediasoup SFU |

Direct probes use STUN without TURN. A P2P route activates only when every peer
edge is connected, non-relayed, healthy, and carrying the required RTP. Topology
changes use make-before-break staging and activate only after every current
client confirms the same topology epoch and media-source revision.

The RTC Statistics panel shows the active route as Direct, Mesh, SFU, or SFU
IPv4. During a handoff, it displays the active and pending routes together.

See [Hybrid media topology](docs/hybrid-media-topology.md) for negotiation,
health checks, failover, recovery, and implementation ownership.

## Requirements

- Bun for dependency management and development
- Node.js 24 for the production server
- PocketBase with the existing DSpeak collections
- A public IP or resolvable address for production WebRTC traffic

DSpeak requires a long-running process because WebSockets and mediasoup
resources are process-owned. Stateless serverless and edge runtimes are not
supported.

## Quick start

```bash
cp .env.example .env
bun install
bun run dev
```

The development server runs at `http://localhost:3000`.

Required environment values:

```dotenv
AUTH_PATH=https://api.example.com/auth
POCKETBASE_URL=https://pocketbase.example.com
PBASE_ADMIN_EMAIL=admin@example.com
PBASE_ADMIN_PASSWORD=change-me
VAPID_PUBLIC_KEY=
VAPID_PUBKEY=
VAPID_PRIVKEY=
```

Local mediasoup defaults:

```dotenv
MEDIASOUP_LISTEN_IP=127.0.0.1
MEDIASOUP_ANNOUNCED_ADDRESS=
MEDIASOUP_RTC_PORT=40000
```

Use `.env.example` as the complete configuration reference. Startup validation
rejects missing credentials, invalid URLs or ports, and unreachable wildcard
mediasoup configurations.

## Production

Build and start the Nitro server:

```bash
bun run build
bun run start
```

`bun run start` loads `.env`. Container deployments inject the same values
through their environment.

Start the included Compose stack:

```bash
docker compose up --build -d
```

Default host ports:

| Port | Purpose |
| --- | --- |
| `31100/tcp` | Nitro HTTP and WebSockets |
| `40000/udp` | Preferred mediasoup RTP |
| `40000/tcp` | mediasoup TCP fallback |

The stack includes a Playit agent for IPv4 fallback and a Cloudflare DDNS
updater for the direct RTC IPv6 hostname. See the [deployment runbook](docs/deployment.md)
for Coolify, Zoraxy, Playit, dynamic IPv6, DNS, firewall, and ICE configuration.

## Video and audio behavior

- Camera and screen capture are independent and can run together.
- Screen audio is transported as a separate source.
- Camera and screen quality can be set independently from 720p through 2160p,
  or left at the original capture resolution.
- Frame-rate settings range from 25 to 60 FPS.
- H.264, VP9, and VP8 are negotiated according to browser capability, with
  hardware-efficient codecs preferred when browser evidence supports them.
- Sustained encoder pressure gradually trades resolution for frame cadence and
  restores quality after recovery.
- Audio uses low-latency Opus settings with NACK and in-band FEC.
- RTC Statistics distinguishes capture, encode, receive, network, and playout
  behavior without assuming that the SFU transcodes media.

## Service endpoints

| Path | Purpose |
| --- | --- |
| `/dspeak/room/*` | Room management |
| `/dspeak/channel/*` | Text and media channels |
| `/dspeak/chat/*` | Messages, read state, and push subscriptions |
| `/dspeak/chat/socket` | Realtime chat WebSocket |
| `/dspeak/presence` | Presence WebSocket |
| `/socket` | Media signaling WebSocket |
| `/health` | Application health |
| `/metrics` | Prometheus-compatible media metrics |

## Project structure

| Directory | Responsibility |
| --- | --- |
| `app/` | Nuxt UI, stores, capture, playback, and WebRTC clients |
| `server/routes/` | Nitro HTTP and WebSocket routes |
| `server/utils/` | PocketBase, mediasoup, ICE, and topology coordination |
| `shared/` | Runtime-neutral topology policy |
| `tests/` | Node unit and policy tests |
| `docs/` | Deployment, topology, and migration details |

## Verification

```bash
bun run test
bun run build
curl http://localhost:3000/health
curl http://localhost:3000/metrics
```

Real releases should also be exercised across current Chrome, Edge, Firefox,
and Safari on multiple networks and devices.

## Security boundary

The media server verifies that a requested user belongs to the room and that the
channel supports media. The inherited API contract currently supplies a user ID
through the `Authorization` header or WebSocket `auth` query parameter. Replacing
that identifier with a signed access token requires a coordinated client and
account-service contract change.

## Further documentation

- [Deployment runbook](docs/deployment.md)
- [Hybrid media topology](docs/hybrid-media-topology.md)
- [Backend migration](docs/backend-migration.md)
