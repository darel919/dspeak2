# Hybrid media topology

DSpeak uses authenticated server signaling with automatic native WebRTC P2P and
mediasoup SFU media routing. The topology coordinator is process-owned and uses
monotonically increasing epochs so messages from an older membership or
transition cannot change the current room.

Rooms with one device allocate no media transport. Rooms with two through four
devices first attempt a complete native `RTCPeerConnection` mesh. Direct probes
use STUN only, trickle ICE, the WebRTC perfect-negotiation pattern, an unreliable
health data channel, and the selected ICE candidate pair. TURN candidates are
excluded from probes. Every pair must connect directly within two seconds;
otherwise the whole room uses mediasoup.

P2P health is checked every second. Three missed exchanges, failed ICE, a
sustained disconnect, or a relay-selected candidate causes the server to select
SFU for the whole room. A fifth participant also selects SFU. After failure,
media-free direct probes may qualify a recovered complete mesh, but it must stay
eligible for ten seconds before activation.

Capture and transport ownership are separate. Microphone, camera, screen video,
and screen audio tracks are reused across topology changes. The destination path
is prepared before the previous path is closed, and remote rendering uses stable
participant and source identities to avoid duplicated playback.

Every handoff uses a two-phase room consensus. The server broadcasts a switching
epoch and source revision, each client stages and verifies the destination RTP,
and activation occurs only after every current client acknowledges that exact
revision. Membership or source changes invalidate earlier acknowledgements.
Failed SFU preparation is retried with a fresh epoch while the active route stays
bound; an unverified destination is never reported as active.

The client media implementation is divided by ownership: `MediaCaptureManager`
owns browser capture, `NativeP2pMesh` owns direct peer connections,
`MediasoupClientSession` owns SFU transports, and `RemoteMediaRegistry` owns
stable playback bindings. `useHybridMediaSession` coordinates those modules and
keeps its public contract topology-neutral.

The RTC Statistics panel contains the diagnostic topology map. It reports
Direct P2P, Mesh P2P, SFU, or SFU IPv4 only from coordinator state and selected
candidate statistics. During switching, active paths remain solid while pending
paths are dashed until consensus activates them. The normal voice UI does not
expose or depend on the active topology.

The current implementation assumes one Nitro process, matching the mediasoup
router and WebSocket ownership model. Multiple application instances require a
shared signaling/state backplane and mediasoup router piping before they can
coordinate the same media room.
