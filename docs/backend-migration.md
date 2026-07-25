# Backend migration

dSpeak now owns the browser application, API, chat, presence, and mediasoup SFU
in one Nuxt and Nitro process. This document records the production boundaries
left by the previous multi-service deployment.

## API migration from `dws-backend`

| Previous responsibility      | Current owner                      |
| ---------------------------- | ---------------------------------- |
| Room, channel, and chat APIs | `server/utils/dspeak-api.js`       |
| Realtime chat                | `server/routes/api/chat/socket.js` |
| Presence                     | `server/routes/api/presence.js`    |
| Media presence updates       | `server/utils/mediasoup-sfu.js`    |
| Privileged PocketBase access | `server/utils/pocketbase.js`       |

The application-owned PocketBase collections are:

- `dspeak_rooms`
- `dspeak_rooms_channels`
- `dspeak_messages`
- `dspeak_users_state`
- `users`

Production authentication, delivery, and offline idempotency add:

- `dspeak_sessions`
- `dspeak_push_subscriptions`
- `dspeak_push_jobs`
- `dspeak_message_revisions`

Message edits use append-only revisions. The original content is revision one,
every accepted edit creates the next revision, and `dspeak_messages.edited_at`
drives the public edited indicator independently from read-receipt updates.
Message authors may edit or unsend their own persisted messages. Room owners and
roles with `message.moderate` may delete other members' messages and inspect
revision history.

The obsolete `dspeak_webpush` and `dspeak_webpush_global` collections are
deleted by `20260725_remove_obsolete_push_collections_v1`. Current clients use
only device-scoped subscriptions.

Room administration adds roles, memberships, branding, media policy,
notifications, identities, and soundboards. Nitro applies these migrations at
startup. See [Room administration contract](room-administration.md).

## SFU migration from `dspeak2-sfu-master`

The `/socket` endpoint now owns media signaling. It validates channel access and
membership, updates media presence, creates mediasoup transports and consumers,
maintains producer ownership, handles keepalive messages, and releases media
resources on disconnect. `/metrics` exposes bounded Prometheus-compatible SFU
gauges.

The former interop WebSocket no longer exists. It connected two
separate services; the equivalent operations are now in-process calls.

## Production runtime

Use the Nitro Node server preset and a persistent process. Stateless serverless
and edge deployments are incompatible with process-owned mediasoup workers,
routers, transports, producers, consumers, and WebSockets.

Run one dSpeak instance. Multiple instances require router piping plus a shared
signaling and state backplane. The Nitro HTTP/WebSocket port and configured
WebRTC TCP/UDP ports must be reachable from clients.
