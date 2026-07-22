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

Remote screen video and its paired audio begin paused. **Start screen share**
resumes both sources for that viewer; **Stop** pauses both again.

- On the SFU route, dSpeak pauses or resumes the viewer's mediasoup consumers.
- On Direct and Mesh routes, the viewer asks the sender to deactivate or
  reactivate the matching RTP encodings.

Merely disabling the rendered video element or track is insufficient because it
would continue consuming network bandwidth.
