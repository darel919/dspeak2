# Screen-share audio and voice-loop prevention

DSpeak requests `restrictOwnAudio` for every display-audio capture. Supporting browsers use it to remove audio produced by the DSpeak tab from the captured audio track. Remote voices continue playing for the sharing participant because local playback suppression remains disabled.

This browser constraint is a best-effort capability. A browser may ignore it, and it cannot reliably isolate DSpeak audio when an operating-system-level mix has already combined all speaker output into one capture source.

For reliable loop prevention when the browser does not report `restrictOwnAudio: true` in the captured audio track settings:

- Share a browser tab rather than an entire screen and enable tab audio.
- Use headphones so remote voices do not enter the microphone acoustically.
- Route DSpeak playback to a different physical output device from the device included in system-audio capture.
- Do not share system audio when voice isolation is more important than shared media sound.

Microphone echo cancellation addresses acoustic speaker-to-microphone feedback. It does not remove a remote voice that is already present in a digital system-audio capture.
