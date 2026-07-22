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
- Stable SFU-first startup before optional Direct or Mesh upgrades
- Seamless, all-client topology handoffs without restarting capture
- IPv6-first SFU routing with Playit IPv4 and authenticated TURN fallbacks
- Animated RTC topology and transport diagnostics
- Same-origin HTTP and WebSocket routes by default

## Media routing

DSpeak establishes the most reliable route first, then upgrades when a complete
direct path proves healthy. The table describes the preferred steady state:

| Participants | Route |
| --- | --- |
| 1 | mediasoup SFU |
| 2 | Direct P2P |
| 3–4 | Full P2P mesh |
| 5+ or unhealthy mesh | mediasoup SFU |

Every occupied call first establishes mediasoup SFU,
attempting native IPv6 before the IPv4 fallback. For rooms with two through four
devices, the server then probes a complete Direct or Mesh path in the background
and switches only after a stable
qualification window and all-client media consensus. Membership changes on an
active P2P room return the room to SFU before qualifying the new mesh.

Direct probes use STUN and may use TURN when direct ICE cannot connect. A P2P
route activates only when every peer edge is connected, healthy, and carrying the required RTP. Topology
changes use make-before-break staging and activate only after every current
client confirms the same topology epoch and media-source revision.
Qualified edges remain monitored throughout the stability window; losing health
or RTP cancels the upgrade before stale readiness can activate P2P.

Switching is coordinated room-wide rather than independently per browser. A
membership change, or a media-source change during handoff, starts a new epoch,
invalidates stale client acknowledgements, and gives the replacement path a
fresh preparation deadline.
The active path remains bound until consensus is complete. Retired P2P peer
connections and SFU transports are explicitly closed after activation so a
later recovery cannot reuse stale tracks, consumers, or producers.
Camera, screen, and audio playback entries keep one participant/source identity
across providers, preventing a topology change or producer replacement from
leaving duplicate remote tiles. Source changes on the active route are applied
in place rather than starting another handoff.

The RTC Statistics panel shows the active route as Direct, Mesh, SFU, or SFU
IPv4. During a handoff, it displays the active and pending routes together.
If direct media falls back, the topology reason retains the concrete trigger,
such as an ICE failure, health timeout, stopped media flow, or signaling error.
SFU IPv4 is the selected ICE path to the same SFU, not a separate application
topology. Native IPv6 candidates have higher ICE priority; the Playit-routed
IPv4 candidate is used only when IPv6 cannot connect. Changing between those
paths does not duplicate media state.

P2P media never operates without the server control connection. Browsers send
sequenced topology heartbeats over the media-signaling WebSocket every five
seconds. The server ACKs matching epochs, NACKs stale epochs with the current
topology, and removes silent peers after twenty seconds. A browser that misses
ACKs for fifteen seconds closes and reconnects its signaling session, allowing
the coordinator to remove disappeared peers promptly without routing heartbeat
data through the media SFU or PocketBase.
Concurrent first joins share one room/router creation, and in-flight joins hold
a reservation so the last departing peer cannot close a router underneath a
new session.

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
| `3478/udp` | IPv6 STUN and TURN |
| `3478/tcp` | IPv6 TURN TCP |
| `5349/tcp` | IPv6 TURN over TLS |
| `49160–49259/udp` | IPv6 TURN relay allocations |

The stack includes a Playit agent for SFU IPv4 fallback, an IPv6 Coturn service,
automatic TURN certificate renewal, and a Cloudflare DDNS updater for the direct
RTC and TURN IPv6 hostnames. See the [deployment runbook](docs/deployment.md)
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

The automated topology suite covers direct two-client consensus, complete
three/four-client mesh policy, five-client SFU selection, repeated SFU recovery,
source changes during handoff, stale failure rejection, stable remote-feed
identity, revocable P2P qualification, repeated source-toggle sender reuse,
concurrent room creation, and IPv4 SFU graph classification. Browser smoke tests
should still exercise real ICE candidates and device/network changes because
those are not fully reproducible in a Node test process.

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
