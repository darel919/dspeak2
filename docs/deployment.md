# Deployment runbook

This runbook contains the network and platform details for deploying DSpeak with
Docker Compose, Coolify, Zoraxy, direct IPv6, and Playit IPv4 fallback.

## Production media environment

```dotenv
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_ADDRESS=auto
MEDIASOUP_ANNOUNCED_ADDRESS_URL=https://api6.ipify.org
MEDIASOUP_RTC_PORT=40000
MEDIASOUP_ANNOUNCED_PORT=40000
MEDIASOUP_DIRECT_ADDRESS=rtc.dspeak.darelisme.my.id
MEDIASOUP_DIRECT_PORT=40000
```

`MEDIASOUP_ANNOUNCED_ADDRESS` must be reachable by browsers. The `auto` value
discovers the container's globally routable outbound IPv6 address. Startup fails
if discovery returns an IPv4, private, link-local, or loopback address. Override
`MEDIASOUP_ANNOUNCED_ADDRESS_URL` with an HTTPS endpoint that returns a plain-text
address when necessary.

When `MEDIASOUP_DIRECT_ADDRESS` is configured, DSpeak advertises the direct
candidate first and keeps the normal announced candidate as fallback. Setting it
to `auto` discovers public IPv6; a failed direct discovery disables only that
candidate. `MEDIASOUP_DIRECT_PORT` defaults to the local RTC port.

Auto-discovery is safe only when inbound traffic to the discovered address and
RTC port reaches the container. Otherwise, use a dedicated DNS-only hostname:

```dotenv
MEDIASOUP_ANNOUNCED_ADDRESS=rtc.dspeak.example.com
```

The RTC hostname must not use the Cloudflare proxy because it does not forward
mediasoup RTP. The HTTPS application hostname may remain proxied.

Optional route overrides should normally remain empty in the monolith:

```dotenv
DSPEAK_API_URL=
DSPEAK_WS_URL=
DSPEAK_SFU_URL=
```

## Docker Compose and Coolify

The Compose stack publishes:

- `31100/tcp` to Nitro port `3000`
- `40000/udp` for preferred RTP
- `40000/tcp` for TCP fallback
- a Playit agent in DSpeak's network namespace

All mediasoup transports share one `WebRtcServer` and one UDP/TCP port.

In Coolify, select the Docker Compose build pack and `/docker-compose.yml`. Add
all required `.env.example` values in the Environment Variables page. Create a
Docker agent in Playit and set its secret as `PLAYIT_SECRET_KEY`; Compose refuses
to deploy without it.

When Zoraxy owns HTTP routing, do not add a Coolify domain or another port
mapping. Forward the application hostname to:

```text
http://<coolify-server-ip>:31100
```

Zoraxy handles HTTPS and WebSockets. RTP bypasses Zoraxy and reaches the Coolify
host directly or through Playit.

## Playit IPv4 fallback

The Playit agent shares DSpeak's container network namespace. Configure the
tunnel's local server address as:

```text
127.0.0.1:40000
```

Create a custom UDP tunnel with one port and disable Proxy Protocol. Keep the
local RTC port unchanged, but advertise Playit's assigned public port and host:

```dotenv
PLAYIT_SECRET_KEY=<docker-agent-secret>
MEDIASOUP_RTC_PORT=40000
MEDIASOUP_ANNOUNCED_PORT=<assigned-playit-public-port>
MEDIASOUP_ANNOUNCED_ADDRESS=<playit-tunnel-hostname-or-ipv4>
MEDIASOUP_DIRECT_ADDRESS=rtc.dspeak.darelisme.my.id
MEDIASOUP_DIRECT_PORT=40000
```

DSpeak rewrites the public candidate port while mediasoup continues listening on
`40000`. Direct IPv6 has higher ICE priority; Playit remains available to
IPv4-only clients or when direct connectivity fails.

## Dynamic RTC IPv6

The Compose stack runs `favonia/cloudflare-ddns` in host-network mode. It reads
the Coolify VM's global IPv6 directly from `ens3`, avoiding Docker bridge and
TrueNAS host addresses, and updates only the RTC AAAA record.

Before enabling it, remove the RTC hostname from any other DDNS updater so two
clients cannot overwrite the record. Keep the Cloudflare record set to DNS only.

Create a scoped Cloudflare token with `Zone / DNS / Edit` permission, then set:

```dotenv
DSPEAK_CLOUDFLARE_API_TOKEN=<scoped-token>
DSPEAK_RTC_DOMAIN=rtc.dspeak.darelisme.my.id
DSPEAK_DDNS_IP6_PROVIDER=local.iface:ens3
```

To use a plain-text external recognizer instead:

```dotenv
DSPEAK_DDNS_IP6_PROVIDER=url:https://6.ident.me
```

For IPv6-only Internet access, forward both UDP and TCP port `40000` to the
Coolify host without changing the port. DNS and auto-discovery advertise an
address; they cannot create the required packet-forwarding path.

## Ports and firewall

The HTTP host port can be changed with:

```dotenv
DSPEAK_HTTP_PORT=31100
```

Equivalent Docker commands:

```bash
docker build -t dspeak .
docker run --env-file .env \
  -p 31100:3000 \
  -p 40000:40000/udp \
  -p 40000:40000/tcp \
  dspeak
```

Allow the HTTP/WebSocket port and the configured WebRTC UDP/TCP port through the
host firewall and deployment platform.

## Production checks

```bash
curl --fail https://<application-host>/health
curl --fail https://<application-host>/metrics
```

Confirm direct IPv6 and Playit IPv4 separately from external networks. The RTC
Statistics map must report the address family from the selected candidate rather
than from DNS or browser assumptions.
