# DSpeak monolith migration

`dspeak2` now owns the DSpeak application, API, realtime chat, presence, and
mediasoup SFU in one Nuxt/Nitro process.

## Migrated from `dws-backend`

| Previous surface                     | Nitro surface                                     |
| ------------------------------------ | ------------------------------------------------- |
| `/dspeak/room/*`                     | `server/utils/dspeak-api.js`                      |
| `/dspeak/channel/*`                  | `server/utils/dspeak-api.js`                      |
| `/dspeak/chat/*`                     | `server/utils/dspeak-api.js`                      |
| `/dspeak/chat/socket`                | `server/routes/dspeak/chat/socket.js`             |
| `/dspeak/presence`                   | `server/routes/dspeak/presence.js`                |
| SFU/backend interop presence updates | Direct calls from `server/utils/mediasoup-sfu.js` |
| PocketBase admin client              | `server/utils/pocketbase.js`                      |

The PocketBase collection contract remains unchanged: `dspeak_rooms`,
`dspeak_rooms_channels`, `dspeak_messages`, `dspeak_webpush`,
`dspeak_webpush_global`, `dspeak_users_state`, and `users`.

The room administration extension adds RBAC, branding, media-policy, and
notification collections. Apply the schema and compatibility migration in
[Room administration contract](room-administration.md) before enabling those
administration surfaces in production.

## Migrated from `dspeak2-sfu-master`

The `/socket` handler now performs channel and membership validation itself,
stores media presence directly in PocketBase, exposes producer-to-user maps,
creates mediasoup transports and consumers, handles keepalive messages, cleans
all media resources on disconnect, and exports Prometheus-compatible gauges at
`/metrics`.

The old `/dspeak/interop` WebSocket is intentionally removed. Its purpose was
communication between two separate services; the equivalent operations are
now in-process and do not require a reconnecting control socket.

## Runtime model

This backend requires the Nitro Node server preset and a long-lived process.
It is not compatible with stateless serverless or edge deployment because the
mediasoup worker, routers, transports, producers, consumers, and WebSockets are
process-owned state.

Use one application instance unless router piping and a distributed signaling
backplane are introduced. The configured WebRTC UDP/TCP range and the Nitro
HTTP/WebSocket port must be reachable from clients.
