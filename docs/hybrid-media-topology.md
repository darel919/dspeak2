# Hybrid media topology

DSpeak uses authenticated server signaling with automatic native WebRTC P2P and
mediasoup SFU media routing. The topology coordinator is process-owned and uses
monotonically increasing epochs so messages from an older membership or
transition cannot change the current room.

Rooms with one device establish mediasoup and remain on it. Rooms with two or more
devices also establish mediasoup first. Native IPv6 SFU candidates are explicitly
prioritized over the Playit-routed IPv4 candidate. After SFU is active, rooms
with two through four devices probe a complete native `RTCPeerConnection` mesh
in the background. Direct probes use STUN only, trickle ICE, the WebRTC
perfect-negotiation pattern, an unreliable health data channel, and the selected
ICE candidate pair. TURN candidates are excluded. Every pair must connect
directly within eight seconds or the room remains on mediasoup.

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

The `/rtc-debug` RTC Statistics dashboard reports
Direct P2P, Mesh P2P, SFU, or SFU IPv4 only from coordinator state and selected
candidate statistics. During switching, active paths remain solid while pending
paths are dashed until consensus activates them. The normal voice UI does not
expose or depend on the active topology.

`app/stores/rtc-stats.js` is the single owner of browser RTC statistics polling,
the current snapshot, video stream measurements, and the bounded sixty-sample
history. The navbar, global connection summary, and `/rtc-debug` dashboard only
render that shared state. This prevents multiple mounted displays from issuing
overlapping `getStats()` calls or presenting different samples. The global
summary intentionally exposes only route health, ping, packet loss, and a Debug
action that opens the full dashboard.

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
Video production is capped at 4.5 Mbps, 1920 by 1080 on SFU, and 60 FPS. Each
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

Topology preference is weighted by mesh size. Two participants hold SFU for ten
seconds and require ten seconds of stable Direct qualification. Three
participants hold SFU for twenty seconds and require twenty seconds of stable
full-mesh qualification. Four participants use thirty-second hold and stability
windows. Every directed edge must remain healthy throughout. An active Direct
route tolerates twenty seconds without health or RTP progress; three- and
four-participant meshes reduce that tolerance to fifteen and ten seconds so one
weak edge returns the room to SFU sooner. Mesh remains supported, while SFU
becomes progressively preferred as aggregate edge risk grows.

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

Native P2P and SFU receivers request a zero-millisecond jitter-buffer target when
the browser implements `RTCRtpReceiver.jitterBufferTarget`, asking for the
shortest playout delay the browser can safely provide. This is a latency
preference, not a fixed buffer size; the browser may retain more media for
network recovery or audio/video synchronization. Active direct routes allow twenty seconds for
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
