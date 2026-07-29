# Deployment runbook

This runbook contains the network and platform details for deploying dSpeak with
Docker Compose, Coolify, Zoraxy, direct IPv6, and Playit IPv4 fallback.

## Media signaling protocol cutovers

Media signaling protocol 919 is strict and has no legacy fallback. Deploying a
build that introduces or changes the `hi919`/`hello919` contract requires
advancing its separate contract revision. Already loaded clients must refresh.
Old tabs are rejected with WebSocket close code 4002 instead of reconnecting
indefinitely. Include this client refresh in the deployment notice and verify
the update-required action before completing the rollout.

## Deployment model

The supported production layout uses one long-running dSpeak container, one
Playit agent for mediasoup and ingest IPv4 fallback, one IPv6 Coturn service, a
certificate sidecar, and Cloudflare DDNS for the direct RTC and ingest
hostnames. HTTP and WebSockets may pass through Zoraxy. RTP, SRT, and TURN
traffic must reach their published ports directly.

Prepare these values before deployment:

- PocketBase and authentication-service credentials
- DNS-only direct RTC and ingest hostnames
- a DNS-only Playit ingest fallback hostname
- a scoped Cloudflare token for direct AAAA updates
- a separate scoped Cloudflare token for the TURN certificate challenge
- a Playit Docker-agent secret
- a random Coturn shared secret
- firewall access for every port listed in this runbook

## Production media environment

```dotenv
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_ADDRESS=auto
MEDIASOUP_ANNOUNCED_ADDRESS_URL=https://api6.ipify.org
MEDIASOUP_RTC_PORT=40000
MEDIASOUP_ANNOUNCED_PORT=40000
MEDIASOUP_DIRECT_ADDRESS=rtc.dspeak.example.com
MEDIASOUP_DIRECT_PORT=40000
MEDIASOUP_MAX_CLIENT_OUTGOING_BITRATE=4500000
MEDIASOUP_MAX_SERVER_OUTGOING_BITRATE=40000000
```

`MEDIASOUP_ANNOUNCED_ADDRESS` must be reachable by browsers. The `auto` value
discovers the container's globally routable outbound IPv6 address. Startup fails
if discovery returns an IPv4, private, link-local, or loopback address. Override
`MEDIASOUP_ANNOUNCED_ADDRESS_URL` with an HTTPS endpoint that returns a plain-text
address when necessary.

When `MEDIASOUP_DIRECT_ADDRESS` is configured, dSpeak advertises the direct
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

The SFU applies the client ceiling to every receive transport and divides the
global server ceiling across all active receive transports whenever the fair
share is lower. Set the global ceiling below the host's measured upload capacity
to leave headroom for transport overhead and non-RTP traffic.

Protected API and WebSocket routes are always same-origin. This is required by
the HttpOnly session cookie and is the supported monolith deployment boundary.

Generate `DSPEAK_CSRF_SECRET` as an independent random value of at least 32
characters. Configure `DSPEAK_PUSH_ALLOWED_HOSTS` as a comma-separated hostname
list when the supported browser push providers are known. See
[Web threat mitigation](web-threat-mitigation.md) for the application and
network egress policy.

Configure Web Push with a stable key pair and monitored contact:

```dotenv
VAPID_PUBLIC_KEY=<public-key>
VAPID_PRIVKEY=<private-key>
VAPID_SUBJECT=mailto:operator@example.com
```

See [Production readiness](production-readiness.md) for migration, monitoring,
restart, and deployed-device notification checks.

## Docker Compose and Coolify

The Compose stack publishes:

- `31100/tcp` to Nitro port `3000`
- `40000/udp` for preferred RTP
- `40000/tcp` for TCP fallback
- `9999/udp` for direct SRT ingest
- a Playit agent in dSpeak's network namespace

All mediasoup transports share one `WebRtcServer` and one UDP/TCP port.
The SRT ingest listener is separate from the mediasoup `WebRtcServer`.

### Coolify setup

In Coolify, select the Docker Compose build pack and `/docker-compose.yml`. Add
all required `.env.example` values in the Environment Variables page. Create a
Docker agent in Playit and set its secret as `PLAYIT_SECRET_KEY`; Compose refuses
to deploy without it.

Production source maps are disabled and the Docker build caps V8's old-space
heap at 768 MiB to keep Nitro's final server-bundling phase within the memory
available to the deployment host. Runtime stack traces still identify generated
server chunks, while local development retains its normal source mapping.

When Zoraxy owns HTTP routing, do not add a Coolify domain or another port
mapping. Forward the application hostname to:

```text
http://<coolify-server-ip>:31100
```

Zoraxy handles HTTPS and WebSockets. RTP bypasses Zoraxy and reaches the Coolify
host directly or through Playit.

## Playit IPv4 fallback

The Playit agent shares dSpeak's container network namespace. Configure the
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
MEDIASOUP_DIRECT_ADDRESS=rtc.dspeak.example.com
MEDIASOUP_DIRECT_PORT=40000
```

dSpeak rewrites the public candidate port while mediasoup continues listening on
`40000`. Direct IPv6 has higher ICE priority; Playit remains available to
IPv4-only clients or when direct connectivity fails.

Playit is used only for the fixed mediasoup port and the fixed SRT ingest port.
Do not create a Playit tunnel for Coturn: TURN relay allocations require a
public relay address that can send to arbitrary peers, which an application
tunnel does not provide.

## SRT ingest routes

Application ingest uses a preferred direct IPv6 route and a separate Playit
IPv4 fallback. Configure these DNS-only Cloudflare records:

| Name                       | Type    | Content                          |
| -------------------------- | ------- | -------------------------------- |
| `live.dspeak.example.com`  | `AAAA`  | The server's public IPv6 address |
| `live4.dspeak.example.com` | `CNAME` | The assigned Playit hostname     |

The Cloudflare DDNS service updates both the RTC and direct ingest AAAA records.
Configure the ingest names and ports with:

```dotenv
DSPEAK_LIVE_DOMAIN=live.dspeak.example.com
DSPEAK_INGEST_LISTEN_PORT=9999
DSPEAK_INGEST_FALLBACK_DOMAIN=live4.dspeak.example.com
DSPEAK_INGEST_FALLBACK_PORT=5627
DSPEAK_INGEST_AUTH_SECRET=<independent-random-secret-of-at-least-32-characters>
```

In Playit, keep Proxy Protocol disabled and configure the second custom UDP
tunnel as:

```text
Public: <assigned-playit-hostname>:<assigned-playit-public-port>
Local: 127.0.0.1:9999
```

The resulting publisher destinations are:

```text
Direct IPv6: srt://live.dspeak.example.com:9999
Playit IPv4: srt://live4.dspeak.example.com:<assigned-playit-public-port>
```

The Compose `dj-ingest` service builds MediaMTX with its configuration embedded,
runs it in dSpeak's network namespace, and
binds the SRT listener. Its HTTP authentication callback is protected by
`DSPEAK_INGEST_AUTH_SECRET`. DNS, Docker port publication, and the Playit tunnel
do not create an SRT listener when that service is stopped.

## Self-hosted IPv6 STUN and TURN

The Compose stack runs Coturn on the host network so its IPv6 relay candidates
refer to the host directly. Configure a dedicated DNS-only AAAA hostname and a
shared authentication secret:

```dotenv
DSPEAK_RTC_DOMAIN=rtc.dspeak.example.com
TURN_PORT=3478
TURN_TLS_PORT=5349
TURN_RELAY_MIN_PORT=49160
TURN_RELAY_MAX_PORT=49259
TURN_SHARED_SECRET=<long-random-secret>
TURN_CREDENTIAL_TTL_SECONDS=900
```

Generate the shared secret with `openssl rand -hex 32`. Nitro uses it only to
create expiring Coturn REST credentials returned by `/api/config`; the
permanent secret is never sent to the browser. Coturn enforces per-user and
total allocation quotas. Tune the defaults only after measuring relay usage:

```dotenv
TURN_USER_QUOTA=12
TURN_TOTAL_QUOTA=1200
TURN_MAX_BPS=25000000
```

The Cloudflare DDNS container updates `DSPEAK_RTC_DOMAIN`, which is shared by
mediasoup and Coturn on different ports. The record must remain DNS-only.
Production clients try this application-owned service first. Public STUN and
best-effort community TURN entries remain last in the ICE configuration so
IPv4-only clients have a relay path while Coturn is IPv6-only.

### TURN TLS certificate

The certificate sidecar obtains and renews a Let's Encrypt certificate using a
Cloudflare DNS challenge. Create a second scoped token limited to Zone DNS Edit
for the TURN zone:

```dotenv
TURN_CERT_EMAIL=operator@example.com
TURN_CLOUDFLARE_API_TOKEN=<scoped-dns-token>
TURN_CERT_DNS_PROPAGATION_SECONDS=30
```

The token is written only to an in-memory private credentials file inside the
certificate container. Certificates are stored in the `turn-certificates`
volume. Coturn starts independently but its supervisor waits for the first
certificate before launching the TURN server. This keeps certificate-provider
failures from blocking the Nitro application deployment. The supervisor detects
renewed certificate files and sends Coturn `SIGUSR2` so new TLS connections use
them without restarting active allocations.

The TURN hostname and certificate environment must be present before starting
Compose. On the first deployment, Coturn remains pending while Certbot completes
the DNS challenge and retries failed issuance; this avoids starting Coturn with
missing TLS files without making TURN availability a prerequisite for deploying
the application.

Both containers emit bounded lifecycle logs. `turn-certbot` reports each
issuance attempt, the Certbot error output, and the next retry or renewal time.
`coturn` reports whether it is waiting for the initial certificate, starting the
TURN server, reloading renewed files, or exiting. Neither log includes the
Cloudflare token, TURN shared secret, or generated credentials.

The Compose service passes `DSPEAK_RTC_DOMAIN` to both containers because their
certificate paths must resolve to the same hostname.

Certbot retains the canonical Let's Encrypt files with their default private
permissions. After a successful issuance or renewal, it atomically publishes
dereferenced certificate and key files under `/etc/letsencrypt/runtime` in the
isolated shared volume. The non-root Coturn container mounts that volume
read-only and reads only these runtime copies. The private key is not exposed as
a host bind mount or included in either image.

Compose builds the pinned Coturn and Certbot base images with their supervisors
included. The entrypoints do not depend on bind-mounted files from Coolify's
temporary deployment checkout, so they remain available after the build helper
and artifact directory are cleaned up.

The Coturn supervisor starts `turnserver` with `-n` because all settings are
provided explicitly by Compose rather than through a `turnserver.conf` file.
The pinned Coturn 4.6.3 command uses only flags supported by that release;
loopback peer rejection relies on Coturn's built-in address validation rather
than the newer `--no-loopback-peers` option.

## Dynamic RTC IPv6

The Compose stack runs `favonia/cloudflare-ddns` in host-network mode. It reads
the Coolify VM's global IPv6 directly from `ens3`, avoiding Docker bridge and
TrueNAS host addresses, and updates only the RTC AAAA record.

Before enabling it, remove the RTC hostname from any other DDNS updater so two
clients cannot overwrite the record. Keep the Cloudflare record set to DNS only.

Create a scoped Cloudflare token with `Zone / DNS / Edit` permission, then set:

```dotenv
DSPEAK_CLOUDFLARE_API_TOKEN=<scoped-token>
DSPEAK_RTC_DOMAIN=rtc.dspeak.example.com
DSPEAK_DDNS_IP6_PROVIDER=local.iface:ens3
```

To use a plain-text external recognizer instead:

```dotenv
DSPEAK_DDNS_IP6_PROVIDER=url:https://6.ident.me
```

For IPv6 Internet access, allow mediasoup UDP/TCP `40000`, SRT ingest UDP `9999`,
Coturn UDP/TCP `3478`, Coturn TCP `5349`, and the configured Coturn UDP relay
range to the Coolify host. DNS and auto-discovery advertise an address; they
cannot create the required packet-forwarding path.

## Ports and firewall

| Traffic                   | Default port                | Required path                       |
| ------------------------- | --------------------------- | ----------------------------------- |
| Nitro HTTP and WebSockets | `31100/tcp` on the host     | Reverse proxy or direct host access |
| mediasoup RTP             | `40000/udp` and `40000/tcp` | Direct IPv6 or Playit IPv4          |
| SRT application ingest    | `9999/udp`                  | Direct IPv6 or Playit IPv4          |
| TURN and STUN             | `3478/udp` and `3478/tcp`   | Direct to host                      |
| TURN over TLS             | `5349/tcp`                  | Direct to host                      |
|                           | TURN relay media            | `49160–49259/udp`                   | Direct to host |

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
  -p 9999:9999/udp \
  dspeak
```

Allow the HTTP/WebSocket port, mediasoup UDP/TCP port, SRT ingest UDP port, TURN
listener ports, and TURN UDP relay range through the host firewall and
deployment platform. Do not forward the TURN ports through Playit or an HTTP
reverse proxy.

## Production checks

Complete every check below before treating the deployment as production-ready.

### Application health

```bash
curl --fail https://<application-host>/health
curl --fail \
  -H "Authorization: Bearer ${DSPEAK_METRICS_TOKEN}" \
  https://<application-host>/metrics
```

The metrics token is required and remains server-side. Reading `/metrics`
without it returns `401` and never starts the mediasoup worker.

Startup environment validation, PocketBase migration, and mediasoup
initialization are mandatory readiness gates. Failure in any gate stops
background work, closes partially created SFU resources, and exits the process
with a nonzero status so the deployment platform cannot retain a
half-initialized listener.

The health response reports `turn.selfHosted.configured` and
`turn.selfHosted.available`. The availability check is a background IPv6 STUN
Binding transaction cached for thirty seconds; health requests only read the
cached result.

### Relay checks

Validate authenticated relay allocations from an external IPv6 network with
Coturn's `turnutils_uclient`, then force `iceTransportPolicy: "relay"` in a test
browser session. Repeat from an IPv4-only network and confirm that a community
TURN relay candidate can be selected. Community services have no availability,
privacy, or capacity guarantee and must be replaced by application-owned IPv4
Coturn when infrastructure permits.

### Direct media checks

Confirm direct IPv6 and Playit IPv4 separately from external networks. The RTC
Statistics map must report the address family from the selected candidate rather
than from DNS or browser assumptions.
