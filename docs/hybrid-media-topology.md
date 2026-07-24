# Hybrid media topology

dSpeak uses authenticated server signaling with automatic native WebRTC P2P and
mediasoup SFU media routing. The topology coordinator is process-owned and uses
monotonically increasing epochs so messages from an older membership or
transition cannot change the current room.

## Route selection

Rooms with one device establish mediasoup and remain on it. Rooms with two or more
devices also establish mediasoup first. Native IPv6 SFU candidates are explicitly
prioritized over the Playit-routed IPv4 candidate. After SFU is active, rooms
with two through four devices probe a complete native `RTCPeerConnection` mesh
in the background. Direct probes use STUN only, trickle ICE, the WebRTC
perfect-negotiation pattern, an unreliable health data channel, and the selected
ICE candidate pair. TURN candidates are excluded. Every pair must connect
directly within eight seconds or the room remains on mediasoup.
When simultaneous offers collide, the polite peer explicitly rolls back its
local offer and completes the remote answer before reapplying RTP sender
parameters. Sender tuning cannot strand signaling in `have-remote-offer`.

## Health and recovery

P2P health is checked every second. A twenty-second health or RTP liveness timeout,
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

## Capture and handoff ownership

Capture and transport ownership are separate. Microphone, camera, screen video,
and screen audio tracks are reused across topology changes. The destination path
is prepared before the previous path is closed, and remote rendering uses stable
participant and source identities to avoid duplicated playback. Video handoffs
replace the track inside the existing rendered `MediaStream`, preserving the
video element and browser fullscreen session while the transport changes.
P2P source toggles reuse their existing RTP sender and receiver track, avoiding
unbounded transceiver growth while explicitly restoring the remote feed.
The destination is considered ready only when every advertised participant and
source identity is staged. Track replacement adds the destination track before
removing the retired track, so activation cannot expose an empty stream or
temporarily remove a fullscreen player.
Local source publication follows the same make-before-break rule. Capture and
device replacement do not report success until every required P2P and SFU
publication completes. P2P removal and replacement are serialized per sender,
and a failed cross-provider replacement restores the previously published
track. Applying microphone settings therefore cannot discard a working
microphone before its replacement is confirmed.
Late provider-close and track-ended events can remove a feed only when both the
provider and track still own its registry entry. Browser fullscreen belongs to
the persistent document root, while the selected logical feed is displayed as
its body-level overlay, outside room layout containing blocks. The same player
DOM node is moved rather than recreated. A transient player teardown therefore
cannot terminate fullscreen; the replacement component resumes the same
participant/source feed identity.

Every handoff uses a two-phase room consensus. The server broadcasts a switching
epoch and source revision, each client stages and verifies the destination RTP,
and activation occurs only after every current client acknowledges that exact
revision. Membership or source changes invalidate earlier acknowledgements.
The activation state carries the prepared transition epoch. A client binds that
already-verified destination without running a second readiness window after
room-wide commitment; an activation without matching lineage must verify media
before it can replace the active provider.
Failed SFU preparation is retried with a fresh epoch while the active route stays
bound; an unverified destination is never reported as active.

The voice UI becomes connected when the authoritative active route is usable.
It does not wait on participant snapshots, producer counters, diagnostic RTP
sampling, or a second topology poll after that route has already passed
readiness. Those signals continue updating call diagnostics without holding the
join screen open after media is available.

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

## Implementation ownership

The client media implementation is divided by ownership: `MediaCaptureManager`
owns browser capture, `NativeP2pMesh` owns direct peer connections,
`MediasoupClientSession` owns SFU transports, and `RemoteMediaRegistry` owns
stable playback bindings. `RemoteMediaHandoff` owns staged provider feeds and
replacement identity. `useHybridMediaSession` coordinates those modules and
keeps its public contract topology-neutral. Server-side room transitions live in
`RoomTopologyCoordinator`, separate from mediasoup signaling operations, so
epochs, consensus, timeouts, recovery, and stale-event rejection can be tested
without a live media worker.

Each authenticated SFU session owns at most one live send transport and one live
receive transport. Repeated transport creation requests return the existing
directional transport instead of allocating another mediasoup resource. A
session can publish only one producer for each supported logical source:
microphone audio, camera video, screen video, and screen audio. The server
validates the source and RTP kind together before allocating the producer.
Producer snapshots received before SFU transport initialization are retained by
the client session and consumed after the receive transport is ready. This
prevents an already-published microphone or shared-audio source from being
missed when topology signaling and producer discovery arrive together.

Initial and reconnected browser state is published after the server sends its
authenticated `connected` acknowledgement. The raw WebSocket open event alone
does not prove that the server has finished installing the session.

## RTC diagnostics

The `/rtc-debug` RTC Statistics dashboard reports
Direct P2P, Mesh P2P, SFU, or SFU IPv4 only from coordinator state and selected
candidate statistics. During switching, active paths remain solid while pending
paths are dashed until consensus activates them. The normal voice UI does not
expose or depend on the active topology.

`app/stores/rtc-stats.js` is the single owner of browser RTC statistics polling,
the current snapshot, per-stream RTP measurements, and the bounded sixty-sample
history. The navbar, global connection summary, and `/rtc-debug` dashboard only
render that shared state. This prevents multiple mounted displays from issuing
overlapping `getStats()` calls or presenting different samples. The global
summary intentionally exposes only route health, ping, packet loss, and a Debug
action that opens the full dashboard.

Direct and Mesh connections use the same detailed peer-connection and RTP
collectors as SFU transports. Codec, frame, packet, jitter, bitrate, candidate,
and audio-buffer fields are displayed whenever the browser reports them;
unsupported fields remain explicitly marked as unreported.

Copy report takes a fresh sample and copies a self-contained text diagnostic with
the current topology, summarized media measurements, sixty-second metric history,
browser environment, and raw statistics for every active peer connection. Browser
security prevents the application from reading `brave://webrtc-internals` or
placing a named attachment on the system clipboard, so the report captures the
equivalent browser-accessible `getStats()` evidence directly without requiring an
internals export.

## Audio policy

Audio policy is topology-neutral. Standard microphone audio uses 48 kHz mono
Opus at 32–96 kbps and defaults to 48 kbps. HD microphone audio is opt-in and
uses stereo Opus from 64 kbps up to 256 kbps. Shared audio remains stereo at
64–256 kbps, with the user's shared-audio ceiling applied when it is lower.
Native P2P and SFU use ten-millisecond packetization, in-band FEC, NACK,
continuous transmission, and high sender priority. Changing a channel ceiling
reapplies the effective limit to active audio senders.

### Remote participant playback

Each remote participant owns one browser `AudioContext`. Voice and shared-audio
tracks enter separate gain nodes and are mixed into a participant-specific
`MediaStreamAudioDestinationNode`. A hidden output element owns output-device
selection. Web Audio gain provides independent volume control from 0% to 200%
without modifying received WebRTC tracks.

Provider handoffs reuse this graph and activate nodes only for the selected
provider. dSpeak closes the graph and removes its output element after the
participant's final audio track closes. Voice-activity analysis branches from
the same graph instead of opening another audio context.

## Video policy

Video capture settings describe the requested source resolution and frame rate.
Channel policy caps camera production at 2 Mbps and screen production between 2
and 6 Mbps. Capture and sender cadence continue to follow the user's selected
target FPS, up to 60 FPS. SFU output remains capped at 1920 by 1080. Each
camera and screen source has a persistent quality priority. The default
frame-rate priority uses `maintain-framerate`, allowing resolution to fall while
keeping cadence as close to the selected target as possible. Resolution priority
uses `maintain-resolution`; its capture cadence may fall but is constrained to a
minimum of 24 FPS. Resolution may therefore fall below the requested
target when browser congestion control needs to protect cadence. Capture settings, sender encoding limits, available upload
bandwidth, and encoder capacity remain independent constraints, so a requested
frame rate is never reported as an achieved rate without outbound RTP evidence.
Camera and screen sources do not override topology selection. Rooms with two to
four participants may qualify and transition from SFU to P2P while video remains
active, using the same ICE, health, RTP-flow, stability, and all-client consensus
requirements as audio-only rooms. During make-before-break preparation, the
browser may temporarily encode the source for both routes. Once P2P activates,
each source has one sender per remote peer and uses its
resolution-and-frame-rate-derived ceiling up to 8 Mbps. Direct video prefers
H.264 when both browsers advertise it, retaining VP9 and VP8 as negotiated
fallbacks. Sender parameters are reapplied after P2P negotiation so a browser
cannot silently lose the configured ceiling during SDP changes.

## Topology timing

Topology preference is weighted by mesh size. Two participants hold SFU for ten
seconds and require ten seconds of stable Direct qualification. Three
participants hold SFU for twenty seconds and require twenty seconds of stable
full-mesh qualification. Four participants use thirty-second hold and stability
windows. Every directed edge must remain healthy throughout. An active Direct
route tolerates twenty seconds without health or RTP progress; three- and
four-participant meshes reduce that tolerance to fifteen and ten seconds so one
weak edge returns the room to SFU sooner. Mesh remains supported, while SFU
becomes progressively preferred as aggregate edge risk grows.

## SFU capacity and codec behavior

Mediasoup forwards RTP without decoding, resizing, or transcoding it. Multiple
receiver qualities require sender-provided simulcast or SVC layers. Screen share
uses one encoding because simulcast would add sender encoders and upload, while
SVC is not enabled without runtime evidence that the negotiated codec and
browser can encode it efficiently in hardware.

SFU receive transports share a global server egress budget. Each client is
capped at 4.5 Mbps, and the per-client ceiling becomes `40 Mbps / active receive
transports` when that value is lower. The defaults are configured with
`MEDIASOUP_MAX_CLIENT_OUTGOING_BITRATE=4500000` and
`MEDIASOUP_MAX_SERVER_OUTGOING_BITRATE=40000000`. These limits cover all RTP
sent through each receive transport, including audio and retransmissions.

RTC transport statistics distinguish measured traffic from bandwidth estimates.
Measured outgoing and incoming bitrate are calculated from candidate-pair byte
deltas. Available outgoing and incoming capacity are browser congestion-control
estimates and do not describe the amount of media currently being transmitted.

During direct qualification, candidate-pair selection and RTP-flow checks share
one browser statistics collection per peer edge and polling tick. This keeps the
250-millisecond readiness probe responsive without repeatedly traversing the
same full `RTCStatsReport`; normal dashboard statistics remain independently
sampled at their lower display cadence.

## Latency and participant quality

Native P2P and SFU receivers use the browser's adaptive jitter-buffer policy.
dSpeak does not force the experimental `RTCRtpReceiver.jitterBufferTarget`
because a zero target can cause received Opus packets to be discarded without
being decoded or played in some Chromium-based browsers. Active direct routes allow twenty seconds for
health or RTP progress and eight seconds for transient ICE disconnection before
recovery begins, while hard ICE, DTLS, or peer-connection failures still fall
back immediately.

Participant signal bars start with the measured RTT band and then apply receive
quality penalties for the remote participant. Packet loss above 5 percent costs
one bar, above 7 percent costs two bars, and above 10 percent forces one bar.
Jitter through 15 ms has no penalty; values above 15, 30, and 50 ms cost one,
two, and three bars respectively, while jitter above 100 ms forces one bar.
Receive-only packet loss remains attached to the remote media source and is not
presented as loss caused by the local participant when that participant has no
outbound RTP.

The current implementation assumes one Nitro process, matching the mediasoup
router and WebSocket ownership model. Multiple application instances require a
shared signaling/state backplane and mediasoup router piping before they can
coordinate the same media room.

## SFU readiness and recovery

SFU signaling readiness is separate from media readiness. Creating the send and
receive transport objects does not mark the call connected. The client tracks
each required direction through transport connectivity, production or
consumption, acknowledged consumer state, fresh RTP byte deltas, and remote
playback. A muted one-person room is reported as ready with no active media; it
is not reported as two-way ICE connectivity.

Every signaling operation that can overlap carries a bounded request ID.
Producer responses can arrive out of order without changing source ownership.
Consumer pause and resume requests carry a desired revision, wait for the
matching acknowledgement, and retry once. RTP liveness requires positive
counter movement over increasing RTC timestamps, so lifetime byte counters
cannot keep a stalled route healthy.

A transient SFU transport disconnection receives a three-second grace period.
A failed direction requests one correlated mediasoup ICE restart. If recovery
fails, the topology coordinator rebuilds the SFU session. Server transport logs
contain only direction, ICE and DTLS state, and selected-tuple presence; they
exclude peer identity, candidate addresses, SDP, fingerprints, and credentials.

Remote participant audio shares one room AudioContext and one voice-activity
scheduler. Output-device and autoplay failures publish playback state instead
of being discarded. The interface offers an Enable audio action backed by a
user gesture and falls back to the default output device when a selected device
disappears.

## Release smoke matrix

Before a production release, exercise these sequences with every participating
browser left connected and verify that audio/video continues, each remote source
has exactly one tile or audio element, and every client reports the same epoch,
mode, participant count, and reason:

| Sequence                                     | Expected result                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| 1 → 2 clients                                | Idle → SFU IPv6 → probe → Direct P2P                                              |
| 2 → 3 → 4 clients                            | Direct → SFU IPv6 → complete P2P mesh with every peer edge                        |
| 4 → 5 clients                                | Mesh → staged SFU → SFU on every client                                           |
| 5 → 4 clients                                | SFU remains active while a complete mesh is probed and staged                     |
| Direct/mesh ICE failure                      | Old route remains until every client has live SFU RTP                             |
| SFU direct recovery failure                  | Existing SFU remains active without a redundant SFU rebuild                       |
| SFU IPv6 unavailable                         | SFU selects the advertised IPv4 candidate without changing media ownership        |
| Camera/screen start or stop during switching | New source revision invalidates old acknowledgements; no stale tile remains       |
| Signaling server restart                     | Clients discard old epochs, reconnect, and republish current capture sources once |

The automated tests cover the coordinator decisions and stale-event behavior.
This matrix remains necessary because browser ICE timing, hardware capture, and
real IPv4/IPv6 routing cannot be proven by the Node test environment.
