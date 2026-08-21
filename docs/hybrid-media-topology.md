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

## Protocol versioning

**Protocol ID 919** is a permanent product identifier. All media-control messages use the 919 family handshake keywords (`hello919`, `hi919`, `error919`). Contract revision 5 provides:

- Server-owned connection epochs (never client-controlled)
- Operation IDs using `crypto.randomUUID()` for idempotent replay
- Post-commit revision ordering (revision incremented before ACK)
- Source generation tracking with stale-generation rejection
- Publication identity fencing with generation + connection epoch
- Non-fatal participant-scoped error responses via OPERATION_ACK NACK
- Heartbeat source digest reconciliation
- Canonical topology application separated from media convergence
- AbortSignal propagation for superseded topology fencing

Incompatible clients are rejected with an update-required error rather than reconnecting indefinitely. Every state-changing message is scoped to the authenticated participant and current route epoch; messages from retired epochs cannot mutate the room.

The media-control WebSocket remains required while P2P media is active because it carries heartbeats, topology state, and peer signaling. It carries control data only, not media packets.

## Bootstrap and signaling

1. The authenticated client calls `POST /api/media/bootstrap` with a Supabase access token, room ID, channel ID, connection mode, and optional device ID.
2. Nitro validates the JWT locally through Supabase JWKS and checks channel membership.
3. Nitro returns the media-control URL and a two-minute EdDSA JWT.
4. The client connects to `wss://media-control.example.com/media-control/<channelId>` and authenticates with that ticket.
5. The Durable Object installs the participant, assigns the authoritative connection epoch (per-participant, server-owned, persisted across hibernation), and coordinates the selected media path.

## Connection modes

- **Auto:** choose among direct P2P, P2P through Cloudflare TURN, Cloudflare Realtime SFU, and a healthy standalone `dspeak-sfu` provider. Selection uses participant count, route qualification, measured quality, and provider health.
- **Direct:** permit direct P2P with STUN only. TURN and all SFU providers are disabled. If every required pair cannot connect directly, the client receives a visible connection failure.

Direct P2P supports up to 8 audio-only participants or 4 participants when video is active. Auto mode supports up to 100 channel participants; it uses a direct mesh only when the active media mix qualifies and otherwise stays on or returns to a TURN or SFU route.

## Route transitions

The Durable Object is the sole topology authority. It advances a monotonically increasing epoch whenever membership, route eligibility, or provider state requires a new decision. Clients stage the destination before retiring the active route. Activation occurs only after required participants acknowledge the matching epoch and source revision.

Capture and transport ownership remain separate. Microphone, camera, screen video, and screen audio tracks are reused across route changes. Remote playback uses stable participant/source identities so a provider transition replaces an existing feed instead of creating duplicate audio elements or video tiles.

A failed destination never replaces a working route. Late provider closures, track-ended events, and responses from retired epochs are identity-checked and cannot remove a newer feed. Once a transition commits, clients close the retired peer connections or provider transports.

**Topology application and convergence are decoupled:** The DO applies canonical topology state synchronously (fast path), while media convergence (track discovery, ICE connection, RTP flow) runs as an independent async task with AbortSignal fencing. Superseded topologies abort their convergence tasks without blocking the pipeline.

## Provider tickets and failure domains

The app-to-control-plane ticket is signed by the main app and verified by `dspeak-media-control`. The control plane uses a different Ed25519 keypair to issue short-lived provider tickets for Cloudflare or `dspeak-sfu` operations. The standalone provider never receives the app's private key and shares no database or process with the main app.

Provider health is maintained by the Durable Object. Failure of standalone `dspeak-sfu` must not destroy room membership or route state; Auto mode selects another eligible provider or reports a bounded failure. See [Media tickets](media-tickets.md).

**Failure scoping:** Errors are categorized by scope (source-operation, remote-consumer, peer-connection, provider-transport, provider-session, control-session) and fatality. Participant-scoped errors (revision conflicts, stale generations, operation timeouts) return OPERATION_ACK NACK without closing the WebSocket. Session-fatal errors (auth failure, protocol violation) close the session.

## Source lifecycle and generation tracking

Each source (audio, video, screen-video, screen-audio) has an independent generation counter managed by the server:

- Client sends `MEDIA_SOURCES` with desired source states and generation
- Server validates: rejects stale generations with `STALE_SOURCE_GENERATION` NACK including canonical state
- Server increments `roomRevision` and `sourceRevision` BEFORE sending OPERATION_ACK (post-commit)
- Desired state decouples mic-mute from camera/screen: only audio source checks `participant.muted`
- Provider publications include `generation` and `connectionEpoch` for identity fencing
- Publication close/start fenced by generation on server and client

## Operation idempotency

- Client generates operation IDs via `crypto.randomUUID()`
- Server accepts client-provided `operationId` as-is for idempotent replay
- Server tracks operation results with 5-minute TTL for duplicate detection
- Client awaits OPERATION_ACK with 5s timeout, rejects with `MEDIA_OPERATION_ACK_TIMEOUT`

## Revision handling

- `roomRevision` and `sourceRevision` are BigInt-safe strings (not numbers)
- Compared as exact strings, not `Number()`
- Post-commit ordering: increment revision BEFORE sending ACK
- Participant-local mutations (`MEDIA_CAPABILITIES`, `LEAVE`) excluded from global CAS

## Heartbeat reconciliation

- Client sends `HEARTBEAT` with `sourceDigest` (per-source hash of generation, state, provider)
- Server computes `localSourceDigest` from `sourceStates`
- On mismatch: server sends `state-nack` with canonical `sourceStates`
- `state-nack` with `sequence` counts as heartbeat ACK

## Connection epoch

- Per-participant, server-owned, never client-controlled
- Persisted in DO durable storage across hibernation
- Included in OPERATION_ACK for MEDIA_SOURCES
- Used in publication identity fencing: `${peerId}|${source}|${generation}|${epoch}`

## Provider fallback and return-to-primary

- Provider health tracked with `unhealthyUntil` timestamp
- Alarm-based recovery scheduling (idempotent, survives hibernation)
- Cloudflare session guarded by `sessionGeneration` to prevent cross-session teardown
- P2P glare/ICE recovery uses perfect negotiation pattern

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
| Rapid source toggle             | Generations increment correctly; no duplicate publications                      |
| Provider failure mid-session    | Fallback activates; return-to-primary on recovery                               |
| Topology supersession           | Old convergence aborted; new topology applied without pipeline stall            |

Unit tests cannot prove browser ICE timing, hardware capture, TURN allocations, Cloudflare Realtime behavior, public firewall rules, or standalone provider reachability.

## Testing coverage

Deterministic protocol tests cover all P0/P1 defects:

- Phase 1: Protocol correctness (leave ordering, heartbeat ACK, epoch ownership, operation IDs, ACK timeout, post-commit revisions, non-fatal errors, canonical snapshot, CAS scope, BigInt revisions)
- Phase 2: Source generation contract (generation tracking, stale rejection, publication fencing, heartbeat reconciliation)
- Phase 3: Receiver convergence (RemoteMediaEntry FSM, publication discovery repair, consumer repair, RTP/first-frame readiness)
- Phase 4: Failure scope (typed failure taxonomy, P2P glare audit, provider fallback/return-to-primary)
- Phase 5: Topology/latency (canonical application/convergence split, head-of-line removal, cancellation fencing, parallel join stages)
- Phase 6: Chaos tests (source races, screen-share matrix, presence chaos, signaling/provider chaos)
