# DJ Mode

DJ Mode lets a voice-channel participant publish audio from an external media
application such as VLC or OBS. The media application remains responsible for
the playlist, playback controls, seeking, repeat behavior, and local monitoring.
dSpeak receives the application's output and distributes it to listeners in the
selected voice channel.

## Status

DJ Mode is implemented for the Docker Compose deployment. MediaMTX accepts
authenticated SRT publishers, dSpeak starts an FFmpeg Opus bridge, and the SFU
publishes the resulting server-owned audio source. External IPv6 and Playit
reachability and audible playback still require production verification.

## Product boundaries

DJ Mode is an application audio sink, not a media player.

dSpeak owns:

- authorization to broadcast into a room and voice channel
- short-lived ingest credentials
- ingest connection and publication status
- the server-owned mediasoup audio producer
- distribution to listeners
- explicit stop, expiration, and cleanup

The publishing application owns:

- file selection and playlists
- play, pause, seek, next, previous, and repeat
- decoding the original media
- optional local playback and monitoring
- metadata when the application and ingest protocol provide it

dSpeak must not require users to paste a generated shell command into a
terminal. The UI should provide publisher connection details that can be entered
into a supported application's streaming-output settings.

## Media path

```text
VLC or OBS
  -> authenticated SRT stream
  -> MediaMTX ingest gateway on UDP 9999
  -> decode or transcode to Opus RTP
  -> mediasoup PlainTransport
  -> server-owned broadcast producer
  -> mediasoup SFU consumers
  -> voice-channel listeners
```

DJ Mode is SFU-only. The ingest gateway is a server-side publisher and cannot
participate in dSpeak's browser-to-browser P2P topology.

## Public ingest routes

The preferred route connects directly over IPv6:

```text
srt://live.dspeak.example.com:9999
```

The IPv4 fallback connects through Playit:

```text
srt://live4.dspeak.example.com:5627
```

Cloudflare records must remain DNS-only:

| Name                       | Type    | Target                           |
| -------------------------- | ------- | -------------------------------- |
| `live.dspeak.example.com`  | `AAAA`  | The server's public IPv6 address |
| `live4.dspeak.example.com` | `CNAME` | The assigned Playit hostname     |

Playit forwards its assigned public UDP endpoint to local `127.0.0.1:9999`. DNS
does not translate ports.

The deployment variables are:

```dotenv
DSPEAK_LIVE_DOMAIN=live.dspeak.example.com
DSPEAK_INGEST_LISTEN_PORT=9999
DSPEAK_INGEST_FALLBACK_DOMAIN=live4.dspeak.example.com
DSPEAK_INGEST_FALLBACK_PORT=<assigned-playit-public-port>
```

See [Deployment](deployment.md#srt-ingest-routes) for firewall, Docker, DDNS,
and Playit configuration.

## Session lifecycle

1. The participant joins a voice channel and opens DJ Mode.
2. dSpeak verifies authentication, room membership, voice-channel membership,
   and permission to broadcast.
3. The server creates a short-lived ingest session bound to the participant,
   room, and channel.
4. The UI presents direct IPv6 and IPv4 fallback connection details containing
   the session's random SRT publishing credential.
5. VLC, OBS, or another supported publisher connects to one of the routes.
6. The gateway validates the stream ID before accepting media.
7. The server creates a mediasoup `PlainTransport`, starts an FFmpeg Opus RTP
   bridge, and creates a server-owned audio producer for the channel.
8. dSpeak reports **Live** only after mediasoup reports incoming RTP.
9. Explicit stop, publisher disconnect, session expiration, channel leave, or
   authorization loss closes the ingest process, transport, and producer.

Cleanup must be idempotent. A failed or repeated stop must not leave an ingest
process, socket, transport, producer, or channel broadcast state behind.

## Authentication and isolation

The public UDP listener must not accept anonymous publication.

Each ingest session must use a cryptographically random, short-lived credential
carried in the SRT stream ID. Server-side validation must bind it to:

- one authenticated user
- one room
- one voice channel
- one active session
- one expiration time

Credentials must be single-purpose, revocable, and excluded from logs and
metrics. The gateway must not trust room IDs, channel IDs, codec parameters, or
process arguments supplied by the publisher. A user must not be able to replace
another active broadcast unless channel policy explicitly permits it.

## Audio contract

The bridge should produce a mediasoup-compatible Opus stream:

- audio only
- 48 kHz clock rate
- one or two channels according to the agreed producer contract
- music-appropriate bitrate
- bounded latency suitable for live listening

The gateway may copy compatible Opus audio or transcode unsupported input.
Transcoding must use server-owned arguments and bounded resources. Publisher
input must never be interpolated into an unrestricted FFmpeg command.

## User interface

DJ Mode should be a nonblocking utility surface rather than a modal that takes
over the room. Users must remain able to read chat, manage voice controls, and
navigate the channel while broadcasting.

The interface should expose:

- waiting, connecting, live, recovering, stopped, and error states
- direct and fallback publisher connection details
- copy actions for the temporary credential-bearing publisher URLs
- concise VLC and OBS setup guidance
- input activity and outbound health
- the current broadcaster identity
- an explicit stop action

It should not duplicate the publishing application's playlist or transport
controls. Optional song metadata may be displayed when reliably supplied, but
metadata must not determine whether audio is live.

## Failure behavior

The UI must distinguish:

- no publisher connected
- invalid or expired credentials
- ingest route unreachable
- unsupported or invalid media
- gateway conversion failure
- mediasoup publication failure
- publisher disconnected

The server should allow bounded reconnection for temporary network loss. After
the recovery window expires, it must close the session and clear the broadcast
state. A signaling success response alone is not proof that audio is flowing.

## Operational requirements

- UDP `9999` must reach the server over direct IPv6.
- Playit must forward public UDP `5627` to local UDP `9999`.
- The ingest gateway and mediasoup bridge must communicate over an internal
  network path that does not require another public port.
- `DSPEAK_INGEST_AUTH_SECRET` must contain an independent random secret of at
  least 32 characters. It authenticates MediaMTX's internal callback and must
  remain server-only.
- Only one Nitro application instance is supported until distributed ownership,
  router piping, and a shared state backplane are introduced.
- Health checks should report gateway readiness without creating a session.
- Metrics must remain bounded and must not use user, room, channel, session, or
  producer identifiers as labels.

## Verification

Production verification requires:

1. publishing from an IPv6-capable external network through the direct route
2. publishing from an IPv4-only external network through Playit
3. audible playback in a second browser connected through the SFU
4. invalid, expired, and revoked credential rejection
5. publisher disconnect and reconnect behavior
6. cleanup after stop, channel leave, and server-side failure

Unit tests and a successful build cannot prove SRT reachability or audible
browser playback.
