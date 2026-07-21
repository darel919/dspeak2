# DSpeak

DSpeak is a self-hosted room, text-chat, presence, and voice application built
as a Nuxt 4 monolith. The browser application and Nitro backend run in the same
process, while PocketBase provides persistent storage and mediasoup provides
the voice SFU.

## Architecture

- Nuxt application and Pinia stores in `app/`
- Nitro HTTP and WebSocket routes in `server/routes/`
- PocketBase-backed room, channel, message, presence, and push services
- Process-owned mediasoup worker, routers, transports, producers, and consumers
- Same-origin API and WebSocket connections by default

The Nitro server exposes:

| Path | Purpose |
| --- | --- |
| `/dspeak/room/*` | Room management |
| `/dspeak/channel/*` | Text and media channel management |
| `/dspeak/chat/*` | Messages, read state, and push subscriptions |
| `/dspeak/chat/socket` | Realtime chat WebSocket |
| `/dspeak/presence` | User presence WebSocket |
| `/socket` | Mediasoup signaling WebSocket |
| `/health` | Application health check |
| `/metrics` | Prometheus-compatible SFU metrics |

## Requirements

- Bun
- Node.js 24 for the production server
- PocketBase with the existing DSpeak collections
- A public IP or resolvable address for production WebRTC traffic

This application requires a long-running Node process. Stateless serverless and
edge runtimes are not supported because WebSockets and mediasoup resources are
owned by the running process.

## Environment

Create the local environment file before installing or starting the app:

```bash
cp .env.example .env
```

Required variables:

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
MEDIASOUP_RTC_MIN_PORT=40000
MEDIASOUP_RTC_MAX_PORT=49999
```

Production mediasoup configuration:

```dotenv
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_ADDRESS=203.0.113.10
MEDIASOUP_RTC_MIN_PORT=40000
MEDIASOUP_RTC_MAX_PORT=49999
```

`MEDIASOUP_ANNOUNCED_ADDRESS` must be reachable by browsers. It is mandatory
when `MEDIASOUP_LISTEN_IP` is `0.0.0.0` or `::`.

The following variables are optional. Leave them empty to use the current
origin and the built-in Nitro routes:

```dotenv
DSPEAK_API_URL=
DSPEAK_WS_URL=
DSPEAK_SFU_URL=
```

Nitro rejects startup when required variables are missing, URLs are invalid,
the RTC port range is invalid, or a wildcard mediasoup bind has no announced
address.

## Development

Install dependencies:

```bash
bun install
```

Start the development server at `http://localhost:3000`:

```bash
bun run dev
```

## Production

Build and start the Nitro server locally:

```bash
bun run build
bun run start
```

`bun run start` explicitly loads `.env`. Container deployments inject the same
variables through the container environment.

### Docker

```bash
docker build -t dspeak .
docker run --env-file .env \
  -p 3000:3000 \
  -p 40000-49999:40000-49999/udp \
  -p 40000-49999:40000-49999/tcp \
  dspeak
```

The HTTP/WebSocket port and the complete configured WebRTC UDP/TCP range must
be allowed by the host firewall and deployment platform.

## Authentication boundary

The SFU validates that the supplied user belongs to the requested room and that
the requested channel is a media channel. The inherited DSpeak API contract
still passes a user identifier through the `Authorization` header or `auth`
WebSocket query parameter. Replacing that identifier with a signed access token
requires a coordinated client and account-service contract change.

## Migration notes

The previous `dws-backend` DSpeak routes and `dspeak2-sfu-master` service are now
implemented inside this repository. See
[`docs/backend-migration.md`](docs/backend-migration.md) for the migration map
and runtime decisions.
