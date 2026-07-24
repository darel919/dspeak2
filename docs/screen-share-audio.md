# Screen-share audio

dSpeak can send screen video and its captured audio as separate media sources.
Browser and operating-system support determines which audio a screen share can
capture.

## Preventing voice loops

dSpeak requests the browser's `restrictOwnAudio` capture constraint. When the
browser supports it, audio produced by the dSpeak tab is removed from the shared
audio track while remote voices continue to play locally.

This constraint is best effort. A browser may ignore it, and it cannot separate
dSpeak from an operating-system mix that already combines all speaker output.
When the captured track does not report `restrictOwnAudio: true`:

- share one browser tab and enable tab audio instead of sharing the full screen;
- use headphones to prevent acoustic microphone feedback;
- send dSpeak playback to an output device that is not part of system capture;
- disable shared audio when voice isolation matters more than media sound.

Microphone echo cancellation only addresses sound traveling from speakers back
into the microphone. It cannot remove a remote voice already present in a
digital screen-audio track.

## Viewer-controlled receiving

Remote screen video begins paused until the viewer selects **Start screen
share**. Shared audio begins playing immediately so audio-only system shares do
not wait for a video action that does not exist. After a paired screen has been
started, **Stop** pauses both its video and audio.

- On the SFU route, dSpeak pauses or resumes the viewer's mediasoup consumers.
- On Direct and Mesh routes, the viewer asks the sender to deactivate or
  reactivate the matching RTP encodings.

Merely disabling the rendered video element or track is insufficient because it
would continue consuming network bandwidth.

## Stream attenuation

Both paired screen audio and audio-only system sharing use the viewer's stream
attenuation setting. While any room participant speaks, the remote playback
gain follows the room reduction, attack, and release values unless the viewer
has enabled or disabled attenuation with a personal override. Changes to the
room policy, personal override, and speaking state apply to active shares
without requiring a rejoin. Local microphone activity updates the playback
gain directly. Remote microphone playback also drives attenuation from its
decoded waveform, so topology changes do not interrupt speech priority.

The sender creates and resumes the shared-audio processing graph before
publishing its destination track to P2P or SFU. Starting system audio therefore
does not report success while the browser-owned processing context is still
suspended. If processing cannot start, publication falls back to the original
captured track so system audio remains available.

Publication is transactional across the active and preparing transports.
Starting a share fails visibly if either required provider rejects it, and any
partial publication is removed instead of leaving a silent source registered.
If the processed destination track ends, the share follows the normal source
teardown path instead of remaining as a zero-bitrate producer.
