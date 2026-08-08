# Hybrid media topology

dSpeak separates application APIs from persistent media control. Nuxt/Nitro authorizes a join and signs a short-lived ticket; an external `dspeak-media-control` Cloudflare Worker and per-channel Durable Object own the live session. Media can use direct P2P, P2P through Cloudflare TURN, Cloudflare Realtime SFU, or the optional standalone `dspeak-sfu` provider.

## Ownership boundaries

| Owner                         | Responsibility                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Nitro `/api/media/bootstrap`  | Validate Supabase identity and room membership; issue an app-to-control-plane ticket       |
| `dspeak-media-control` Worker | WebSocket endpoint and protocol handling                                                   |
| `MediaRoomDO` per channel     | Membership, route epoch, P2P signaling relay, health, provider selection, and route commit |
| Cloudflare Realtime           | Managed SFU media forwarding                                                               |
| Cloudflare TURN               | Relay candidates when direct connectivity fails                                            |
| `dspeak-sfu`                  | Optional standalone mediasoup provider                                                     |
| Supabase Realtime             | Chat, typing, presence, and notifications only; never media topology                       |

The main Nuxt/Nitro process contains no mediasoup worker, router, transport, producer, or consumer. It does not own the media WebSocket and can scale independently on Vercel.

## Bootstrap and signaling

1. The authenticated client calls `POST /api/media/bootstrap` with a Supabase access token, room ID, channel ID, connection mode, and optional device ID.
2. Nitro validates the JWT locally through Supabase JWKS and checks channel membership.
3. Nitro returns the media-control URL and a two-minute EdDSA JWT.
4. The client connects to `wss://media-control.example.com/media-control/<channelId>` and authenticates with that ticket.
5. The Durable Object installs the participant, assigns the authoritative route epoch, and coordinates the selected media path.

Protocol ID 919 is a permanent product identifier. Its contract revision provides atomic client/server cutovers. Incompatible clients are rejected with an update-required error rather than reconnecting indefinitely. Every state-changing message is scoped to the authenticated participant and current route epoch; messages from retired epochs cannot mutate the room.

The media-control WebSocket remains required while P2P media is active because it carries heartbeats, topology state, and peer signaling. It carries control data only, not media packets.

## Connection modes

- **Auto:** choose among direct P2P, P2P through Cloudflare TURN, Cloudflare Realtime SFU, and a healthy standalone `dspeak-sfu` provider. Selection uses participant count, route qualification, measured quality, and provider health.
- **Direct:** permit direct P2P with STUN only. TURN and all SFU providers are disabled. If every required pair cannot connect directly, the client receives a visible connection failure.

Initial benchmark gates are 12 participants for direct audio only, 4 for direct video, 8 for Auto P2P audio only, and 4 for Auto P2P with video. These are eligibility ceilings, not guarantees; a room remains on or returns to an SFU/relay route when direct qualification fails.

## Route transitions

The Durable Object is the sole topology authority. It advances a monotonically increasing epoch whenever membership, route eligibility, or provider state requires a new decision. Clients stage the destination before retiring the active route. Activation occurs only after required participants acknowledge the matching epoch and source revision.

Capture and transport ownership remain separate. Microphone, camera, screen video, and screen audio tracks are reused across route changes. Remote playback uses stable participant/source identities so a provider transition replaces an existing feed instead of creating duplicate audio elements or video tiles.

A failed destination never replaces a working route. Late provider closures, track-ended events, and responses from retired epochs are identity-checked and cannot remove a newer feed. Once a transition commits, clients close the retired peer connections or provider transports.

## Provider tickets and failure domains

The app-to-control-plane ticket is signed by the main app and verified by `dspeak-media-control`. The control plane uses a different Ed25519 keypair to issue short-lived provider tickets for Cloudflare or `dspeak-sfu` operations. The standalone provider never receives the app's private key and shares no database or process with the main app.

Provider health is maintained by the Durable Object. Failure of standalone `dspeak-sfu` must not destroy room membership or route state; Auto mode selects another eligible provider or reports a bounded failure. See [Media tickets](media-tickets.md).

## Audio and video policy

Standard microphone audio uses 48 kHz mono Opus at 32–96 kbps and defaults to 48 kbps. HD microphone and shared audio use stereo Opus from 64–256 kbps. Channel policy caps camera production at 2 Mbps and screen production between 2 and 6 Mbps. Capture settings, sender limits, available upload, and encoder capacity remain independent constraints.

A standalone mediasoup provider forwards RTP without decoding, resizing, or transcoding. Any provider-specific bitrate, codec, announced-address, and RTC-port settings belong to the `dspeak-sfu` deployment, not the main app.

## Diagnostics and verification

The `/rtc-debug` dashboard reports the authoritative route and browser-observable ICE/RTP statistics. It must distinguish direct P2P, TURN relay, Cloudflare Realtime SFU, and standalone SFU without inferring a route from DNS alone. Metrics and copied diagnostics must exclude tickets, ICE credentials, SDP, candidate addresses where unnecessary, and personal identifiers.

Before a media release, verify with real clients on separate external networks:

| Sequence                        | Expected result                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------- |
| One client joins                | A provider route becomes usable without an embedded Nitro media worker          |
| Second client joins in Auto     | Direct route is qualified; otherwise a healthy SFU or TURN route remains active |
| Direct mode cannot connect      | Visible failure; no TURN or SFU fallback                                        |
| Cloudflare TURN forced          | Relay candidate is selected and media remains usable                            |
| Cloudflare Realtime forced      | Managed SFU route carries all published sources                                 |
| `dspeak-sfu` enabled            | Provider ticket succeeds and standalone SFU carries media                       |
| `dspeak-sfu` stopped            | Durable Object retains membership and selects another eligible route            |
| Source starts during transition | New source revision invalidates stale acknowledgements; no duplicate feed       |
| Media-control reconnect         | Client discards stale epochs and republishes current source state once          |

Unit tests cannot prove browser ICE timing, hardware capture, TURN allocations, Cloudflare Realtime behavior, public firewall rules, or standalone provider reachability.
