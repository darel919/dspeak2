# Production readiness

This document is the release gate for dSpeak. A successful build is necessary,
but it does not prove that background delivery, public networking, or browser
installation works in the deployed environment.

## Background notifications

dSpeak uses standards-based Web Push. The server persists one subscription per
installed browser device and creates durable delivery jobs when a message is
accepted. A process-owned dispatcher retries transient provider failures with
backoff, expires jobs after 24 hours, and disables endpoints rejected with HTTP
404 or 410.

Periodic Background Sync is intentionally not part of notification delivery.
Web Push wakes the installed service worker for a push event even when no dSpeak
window is open. Periodic Sync is browser-scheduled, inconsistently supported,
and unsuitable for timely message delivery.

The service worker displays the notification and opens the exact room and
channel when it is clicked. The server suppresses delivery to the sending user
and to a recipient device that is actively viewing the channel. Other devices
for the same recipient still receive the push.

On iPhone and iPad, the user must add dSpeak to the Home Screen and grant
notification permission from the installed application. Closing the installed
application does not disable an active Web Push subscription, but operating
system policy, Focus modes, battery controls, and a force-disabled application
can still delay or suppress presentation.

## Authentication and offline delivery

The external access token is exchanged once for a random, server-stored session.
Only a SHA-256 hash is stored in PocketBase. The browser receives the opaque
token in a Secure, HttpOnly, SameSite=Strict cookie and never stores the external
access token in local storage or an offline queue.

Protected HTTP and WebSocket endpoints are same-origin. The server derives the
user and device from the session; request bodies and query strings are not an
identity authority. Creating a new session rotates the previous session for the
same user and device.

Offline outgoing messages contain a stable client message ID and owner ID. The
owner ID keeps one user's local queue separate from another; the server still
authenticates from the cookie and rejects an owner mismatch. The message
uniqueness constraint makes page retries and service-worker retries idempotent.
Background Sync is a progressive enhancement. Reconnection, controller
activation, and an explicit retry also flush the queue.

## Required configuration

Production requires:

- `POCKETBASE_URL`, `POCKETBASE_EMAIL`, and `POCKETBASE_PASSWORD`
- `AUTH_PATH`
- `DSPEAK_PUBLIC_ORIGIN` and `DSPEAK_METRICS_TOKEN`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVKEY`, and `VAPID_SUBJECT`
- the media, TURN, DNS, and firewall configuration in
  [Deployment](deployment.md)

Keep VAPID keys stable across releases. Rotating them invalidates existing push
subscriptions and requires every device to subscribe again. `VAPID_SUBJECT`
must be a monitored `mailto:` or HTTPS contact URI.

The startup migration creates `dspeak_sessions`,
`dspeak_push_subscriptions`, and `dspeak_push_jobs`, adds stable message client
IDs, and reconciles historical duplicate message notifications before applying
their uniqueness constraint. Back up PocketBase before the first production
deployment and verify the migration records after startup.

## Operational checks

The identity service contract accepts `POST <AUTH_PATH>/verify` with the access
token in an `Authorization: Bearer` header. It must never accept or log the
token as a query value. dSpeak rejects browser WebSocket and state-changing
HTTP origins that do not match `DSPEAK_PUBLIC_ORIGIN`. Set the originless
client overrides only for an explicitly reviewed non-browser integration.

`/health` reports the oldest queued push delivery and cached subsystem health.
`/metrics` requires `Authorization: Bearer <DSPEAK_METRICS_TOKEN>` and exposes
push deliveries, retries, failures, expiry, active
subscriptions, pending jobs, and oldest pending age. Alert when pending age
continues growing or failures increase without deliveries.

Before release:

1. Run `bun install --frozen-lockfile`.
2. Run `bun audit`, `bun run format:check`, `bun run test`, and
   `bun run build`.
3. Back up PocketBase and start the built server against the target migration
   environment.
4. Confirm `/health` and authenticated `/metrics`, then restart the server with pending push
   and offline-message work and confirm that processing resumes.
5. Build and start the Docker Compose deployment and probe its public HTTP,
   WebSocket, RTP, and TURN paths.

## Deployed device matrix

The release is not declared production-ready until all of these pass on the
deployed HTTPS origin:

| Platform               | Install and subscribe | App closed push | Exact click target | Preference and unsubscribe |
| ---------------------- | --------------------- | --------------- | ------------------ | -------------------------- |
| Chromium desktop       | Required              | Required        | Required           | Required                   |
| Chromium Android       | Required              | Required        | Required           | Required                   |
| Firefox desktop        | Required              | Required        | Required           | Required                   |
| Firefox Android        | Required              | Required        | Required           | Required                   |
| Safari macOS           | Required              | Required        | Required           | Required                   |
| iOS/iPadOS Home Screen | Required              | Required        | Required           | Required                   |

For each row, also verify message preview privacy, mentions-only mode, muted
mode, sender exclusion, active-device suppression, another-device delivery, a
real push test, logout, expired session behavior, offline send/reconnect, and a
stale subscription cleanup.

Local unit tests cannot prove push-provider delivery, operating-system
presentation, installed-PWA policy, reverse-proxy cookie behavior, public
firewalls, or device-specific notification controls.
