# Hybrid media topology

DSpeak uses authenticated server signaling with automatic native WebRTC P2P and
mediasoup SFU media routing. The topology coordinator is process-owned and uses
monotonically increasing epochs so messages from an older membership or
transition cannot change the current room.

Rooms with one device allocate no media transport. Rooms with two or more
devices establish mediasoup first. Native IPv6 SFU candidates are explicitly
prioritized over the Playit-routed IPv4 candidate. After SFU is active, rooms
with two through four devices probe a complete native `RTCPeerConnection` mesh
in the background. Direct probes use STUN only, trickle ICE, the WebRTC
perfect-negotiation pattern, an unreliable health data channel, and the selected
ICE candidate pair. TURN candidates are excluded. Every pair must connect
directly within eight seconds or the room remains on mediasoup.

P2P health is checked every second. A ten-second health or RTP liveness timeout,
failed ICE restart, signaling failure, closed health channel, or a relay-selected
candidate causes the server to select SFU for the whole room. Brief browser stats
stalls and muted or idle sources do not immediately fail an active direct route.
A fifth participant also selects SFU. After failure, direct probes may qualify a
recovered complete mesh, but it must stay eligible for ten seconds before
activation. Qualification remains revocable during that window: health-channel
or RTP silence for five seconds cancels the upgrade while SFU remains active.

The server WebSocket remains mandatory while P2P media is active. A sequenced
five-second heartbeat carries the client's topology epoch and source revision.
The server ACKs a matching state, NACKs a stale state with the authoritative
topology, and expires a silent session after twenty seconds. Clients reconnect
after fifteen seconds without an acknowledgement. This is control-plane data;
it does not pass through mediasoup media transports or use PocketBase polling.

Room creation is single-flight. Simultaneous first joins share one mediasoup
router, and an in-flight join reserves that room until its session is registered
so a concurrent final departure cannot dispose the router prematurely.

Capture and transport ownership are separate. Microphone, camera, screen video,
and screen audio tracks are reused across topology changes. The destination path
is prepared before the previous path is closed, and remote rendering uses stable
participant and source identities to avoid duplicated playback.
P2P source toggles reuse their existing RTP sender and receiver track, avoiding
unbounded transceiver growth while explicitly restoring the remote feed.

Every handoff uses a two-phase room consensus. The server broadcasts a switching
epoch and source revision, each client stages and verifies the destination RTP,
and activation occurs only after every current client acknowledges that exact
revision. Membership or source changes invalidate earlier acknowledgements.
Failed SFU preparation is retried with a fresh epoch while the active route stays
bound; an unverified destination is never reported as active.

Media-source revisions on an already-active route update its expected sources
in place; they do not re-run provider activation. This prevents rapid camera,
screen, or microphone changes from turning a superseded readiness poll into a
call failure. If an active SFU transport itself fails, the client reports the
current epoch and the coordinator starts a room-wide SFU rebuild so participants
cannot silently diverge onto different sessions.

Queued client events are also revision-aware. If a newer topology arrives while
a browser is checking destination RTP, the old check stops without reporting a
failure for the new transition. After activation, the retired provider is fully
closed: P2P peer connections and staged feeds are discarded, while SFU clients
explicitly ask the server to close their old producers, consumers, and
transports. Late track-ended callbacks are identity-checked and cannot delete a
replacement feed.
Remote playback identity is based on participant and media source, rather than a
temporary producer or track ID. The same camera therefore replaces its prior
Direct, Mesh, or SFU representation instead of creating duplicate tiles.

The client media implementation is divided by ownership: `MediaCaptureManager`
owns browser capture, `NativeP2pMesh` owns direct peer connections,
`MediasoupClientSession` owns SFU transports, and `RemoteMediaRegistry` owns
stable playback bindings. `RemoteMediaHandoff` owns staged provider feeds and
replacement identity. `useHybridMediaSession` coordinates those modules and
keeps its public contract topology-neutral. Server-side room transitions live in
`RoomTopologyCoordinator`, separate from mediasoup signaling operations, so
epochs, consensus, timeouts, recovery, and stale-event rejection can be tested
without a live media worker.

The RTC Statistics panel contains the diagnostic topology map. It reports
Direct P2P, Mesh P2P, SFU, or SFU IPv4 only from coordinator state and selected
candidate statistics. During switching, active paths remain solid while pending
paths are dashed until consensus activates them. The normal voice UI does not
expose or depend on the active topology.

Direct and Mesh connections use the same detailed peer-connection and RTP
collectors as SFU transports. Codec, frame, packet, jitter, bitrate, candidate,
and audio-buffer fields are displayed whenever the browser reports them;
unsupported fields remain explicitly marked as unreported.

Audio policy is topology-neutral. Microphone and shared-audio senders use the
voice channel bitrate ceiling, with the user's shared-audio ceiling applied when
it is lower. Both native P2P and SFU request 48 kHz stereo Opus, ten-millisecond
packetization, in-band FEC, NACK, continuous transmission, and high sender
priority. Changing the shared-audio or channel ceiling reapplies the effective
limit to active audio senders.

Video capture settings describe the requested source resolution and frame rate.
Native P2P applies the same resolution-aware bitrate ceiling and high priority as
SFU production, while asking the browser to maintain frame rate when congestion
requires degradation. Resolution may therefore fall below the requested target
to protect cadence. Capture settings, sender encoding limits, available upload
bandwidth, and encoder capacity remain independent constraints, so a requested
frame rate is never reported as an achieved rate without outbound RTP evidence.

The current implementation assumes one Nitro process, matching the mediasoup
router and WebSocket ownership model. Multiple application instances require a
shared signaling/state backplane and mediasoup router piping before they can
coordinate the same media room.

## Release smoke matrix

Before a production release, exercise these sequences with every participating
browser left connected and verify that audio/video continues, each remote source
has exactly one tile or audio element, and every client reports the same epoch,
mode, participant count, and reason:

| Sequence | Expected result |
| --- | --- |
| 1 → 2 clients | Idle → SFU IPv6 → probe → Direct P2P |
| 2 → 3 → 4 clients | Direct → SFU IPv6 → complete P2P mesh with every peer edge |
| 4 → 5 clients | Mesh → staged SFU → SFU on every client |
| 5 → 4 clients | SFU remains active while a complete mesh is probed and staged |
| Direct/mesh ICE failure | Old route remains until every client has live SFU RTP |
| SFU direct recovery failure | Existing SFU remains active without a redundant SFU rebuild |
| SFU IPv6 unavailable | SFU selects the advertised IPv4 candidate without changing media ownership |
| Camera/screen start or stop during switching | New source revision invalidates old acknowledgements; no stale tile remains |
| Signaling server restart | Clients discard old epochs, reconnect, and republish current capture sources once |

The automated tests cover the coordinator decisions and stale-event behavior.
This matrix remains necessary because browser ICE timing, hardware capture, and
real IPv4/IPv6 routing cannot be proven by the Node test environment.
