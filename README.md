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
MEDIASOUP_RTC_PORT=40000
```

Production mediasoup configuration:

```dotenv
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_ADDRESS=auto
MEDIASOUP_ANNOUNCED_ADDRESS_URL=https://api6.ipify.org
MEDIASOUP_RTC_PORT=40000
MEDIASOUP_ANNOUNCED_PORT=40000
MEDIASOUP_DIRECT_ADDRESS=rtc.dspeak.darelisme.my.id
MEDIASOUP_DIRECT_PORT=40000
```

`MEDIASOUP_ANNOUNCED_ADDRESS` must be reachable by browsers. Set it to `auto`
to discover the container's globally routable outbound IPv6 address during
startup. The server refuses to start if discovery fails or returns a private,
link-local, loopback, or IPv4 address. Override
`MEDIASOUP_ANNOUNCED_ADDRESS_URL` with an HTTPS endpoint that returns only the
address as plain text if the default endpoint is unsuitable.

When `MEDIASOUP_DIRECT_ADDRESS` is set, DSpeak sends two ICE candidates. The
direct candidate has higher priority and the normal announced candidate is the
fallback. Set the direct address to `auto` to discover a public IPv6 address;
failure to discover IPv6 only disables the direct candidate and does not stop
the Playit fallback. `MEDIASOUP_DIRECT_PORT` defaults to the local RTC port.

Auto-discovery is correct only when inbound traffic to the discovered IPv6
address on the RTC port reaches this container. If the public IPv6 is
owned by another host, use a dedicated DNS-only hostname instead:

```dotenv
MEDIASOUP_ANNOUNCED_ADDRESS=rtc.dspeak.example.com
```

Keep that hostname updated through the host's dynamic-DNS client. It must not
be proxied by Cloudflare: the normal Cloudflare proxy does not forward
mediasoup RTP. The HTTPS application hostname can remain proxied.

The Compose stack includes `favonia/cloudflare-ddns` in host-network mode. It
reads the Coolify VM's global IPv6 directly from `ens3` and updates only the
DNS-only RTC AAAA record. This avoids returning the TrueNAS host address or a
Docker bridge address.

The following variables are optional. Leave them empty to use the current
origin and the built-in Nitro routes:

```dotenv
DSPEAK_API_URL=
DSPEAK_WS_URL=
DSPEAK_SFU_URL=
```

Nitro rejects startup when required variables are missing, URLs are invalid,
the RTC port is invalid, or a wildcard mediasoup bind has no announced address.

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

### Docker Compose and Coolify

The repository includes `docker-compose.yml` with these default host mappings
and an official Playit agent sidecar:

- `31100/tcp` → Nitro HTTP and WebSockets on container port `3000`
- `40000/udp` → mediasoup RTP
- `40000/tcp` → mediasoup TCP fallback
- `playit-agent` → public IPv4 tunnel into DSpeak's network namespace

Mediasoup uses a shared `WebRtcServer`, so all send and receive transports use
this single UDP/TCP port instead of allocating a port per transport.

Start it locally with:

```bash
docker compose up --build -d
```

For Coolify, select the **Docker Compose** build pack and use
`/docker-compose.yml`. Add every required value from `.env.example` in
Coolify's Environment Variables page. Create a Docker agent in the Playit
dashboard and set its secret as `PLAYIT_SECRET_KEY`; Compose refuses to deploy
without it. Do not configure a Coolify domain or extra port mapping for this
service when Zoraxy owns HTTP routing; the Compose file already publishes host
port `31100`.

Configure Zoraxy to forward `dspeak.darelisme.my.id` to:

```text
http://<coolify-server-ip>:31100
```

Zoraxy handles HTTPS and WebSocket traffic. RTP bypasses Zoraxy and reaches the
Coolify host directly or through Playit on the shared mediasoup port.

For IPv6-only Internet access, the advertised IPv6 endpoint must forward both
UDP and TCP port `40000` to `10.10.10.250` without changing the port number.
This forwarding is separate from Zoraxy. If `10.10.10.250` has no routable IPv6
of its own, the TrueNAS host or upstream router must provide working IPv6-to-
IPv4 forwarding for that port; DNS and application auto-discovery cannot
create that packet path.

### Playit IPv4 tunnel

The agent shares DSpeak's container network namespace, so configure the Playit
tunnel's local server address as:

```text
127.0.0.1:40000
```

Create a custom UDP tunnel with a port count of one and disable Proxy Protocol.
Playit assigns the public port. Keep `MEDIASOUP_RTC_PORT` on the local port,
set `MEDIASOUP_ANNOUNCED_PORT` to Playit's assigned public port, and set
`MEDIASOUP_ANNOUNCED_ADDRESS` to the public hostname or IPv4 address shown for
the tunnel:

```dotenv
PLAYIT_SECRET_KEY=<docker-agent-secret>
MEDIASOUP_RTC_PORT=40000
MEDIASOUP_ANNOUNCED_PORT=<assigned-playit-public-port>
MEDIASOUP_ANNOUNCED_ADDRESS=<playit-tunnel-hostname-or-ipv4>
MEDIASOUP_DIRECT_ADDRESS=rtc.dspeak.darelisme.my.id
MEDIASOUP_DIRECT_PORT=40000
```

DSpeak rewrites the port in the ICE candidate sent to browsers while mediasoup
continues listening on port `40000`. Direct IPv6 is advertised first with a
higher ICE priority; Playit remains available to IPv4-only clients and when the
direct candidate cannot connect. After entering Playit's assigned address and
port, redeploy the stack.

### Dynamic RTC IPv6

Before enabling the stack updater, remove `rtc.dspeak.darelisme.my.id` from the
TrueNAS DDNS updater so two clients do not overwrite the same record. Leave its
Cloudflare proxy status set to **DNS only**.

Create a scoped Cloudflare API token with `Zone / DNS / Edit` permission for
`darelisme.my.id`, then add these runtime variables in Coolify:

```dotenv
DSPEAK_CLOUDFLARE_API_TOKEN=<scoped-token>
DSPEAK_RTC_DOMAIN=rtc.dspeak.darelisme.my.id
DSPEAK_DDNS_IP6_PROVIDER=local.iface:ens3
```

The default local-interface provider does not contact an external IP service;
it reads the exact global address bound to the VM. To use a plain-text external
recognizer instead, set for example:

```dotenv
DSPEAK_DDNS_IP6_PROVIDER=url:https://6.ident.me
```

Because the updater uses `network_mode: host`, the request originates from the
VM's IPv6 rather than the DSpeak container network. The updater checks for
changes periodically and reconciles the Cloudflare AAAA record automatically.

The HTTP host port can be changed with:

```dotenv
DSPEAK_HTTP_PORT=31100
```

Equivalent direct Docker commands are:

```bash
docker build -t dspeak .
docker run --env-file .env \
  -p 31100:3000 \
  -p 40000:40000/udp \
  -p 40000:40000/tcp \
  dspeak
```

The HTTP/WebSocket port and configured WebRTC UDP/TCP port must be allowed by
the host firewall and deployment platform when direct access is enabled.

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
