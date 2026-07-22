# Backend migration

dSpeak now owns the browser application, API, chat, presence, and mediasoup SFU
in one Nuxt and Nitro process. This document records the production boundaries
left by the previous multi-service deployment.

## API migration from `dws-backend`

| Previous responsibility      | Current owner                         |
| ---------------------------- | ------------------------------------- |
| Room, channel, and chat APIs | `server/utils/dspeak-api.js`          |
| Realtime chat                | `server/routes/dspeak/chat/socket.js` |
| Presence                     | `server/routes/dspeak/presence.js`    |
| Media presence updates       | `server/utils/mediasoup-sfu.js`       |
| Privileged PocketBase access | `server/utils/pocketbase.js`          |

The original PocketBase collections remain supported:

- `dspeak_rooms`
- `dspeak_rooms_channels`
- `dspeak_messages`
- `dspeak_webpush`
- `dspeak_webpush_global`
- `dspeak_users_state`
- `users`

Room administration adds roles, memberships, branding, media policy,
notifications, identities, and soundboards. Nitro applies these migrations at
startup. See [Room administration contract](room-administration.md).

## SFU migration from `dspeak2-sfu-master`

The `/socket` endpoint now owns media signaling. It validates channel access and
membership, updates media presence, creates mediasoup transports and consumers,
maintains producer ownership, handles keepalive messages, and releases media
resources on disconnect. `/metrics` exposes bounded Prometheus-compatible SFU
gauges.

The former `/dspeak/interop` WebSocket no longer exists. It connected two
separate services; the equivalent operations are now in-process calls.

## Production runtime

Use the Nitro Node server preset and a persistent process. Stateless serverless
and edge deployments are incompatible with process-owned mediasoup workers,
routers, transports, producers, consumers, and WebSockets.

Run one dSpeak instance. Multiple instances require router piping plus a shared
signaling and state backplane. The Nitro HTTP/WebSocket port and configured
WebRTC TCP/UDP ports must be reachable from clients.
