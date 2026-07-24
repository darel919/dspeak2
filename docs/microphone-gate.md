# Microphone gate

The microphone gate controls local speech detection sensitivity while browser
echo cancellation and noise suppression remove background noise from the
microphone track. It never pauses the microphone RTP sender: a suspended Web
Audio analyser or a threshold miss must not create one-way audio. Camera, screen
share, shared audio, soundboards, and remote playback remain independent.

## Modes

- **Automatic:** Measures the local noise floor and chooses an opening threshold.
  This is used after a person explicitly enables the gate. New and reset
  browsers leave the gate disabled so microphone transport is fail-open. The
  estimator uses the quietest portion of a rolling five-second input window, so
  it can bootstrap from raw room noise and is not dependent on browser echo
  cancellation, noise suppression, or automatic gain control. The opening level
  stays 16 dB above the estimated floor, bounded between -56 dBFS and -28 dBFS,
  so moderate bumps in room noise remain closed. While the gate is open, speech
  freezes upward adjustment. A continuously open signal can establish the
  initial floor only after remaining nearly level for three seconds.
- **Manual:** Uses a user-selected threshold from -60 dBFS to -20 dBFS.
- **Bypassed:** HD audio channels always bypass the gate. The saved setting is
  retained and applies again when the user joins a standard audio channel.

Echo cancellation, noise suppression, and automatic gain control remain
separate capture settings. Noise suppression can stay enabled in an HD audio
channel even though the gate is bypassed.

## Microphone setup and mic check

Opening **Voice & Video** starts a local microphone level preview in the
**Microphone setup** section. The preview shows:

- current input level;
- effective opening threshold; and
- open or closed gate state.

The user can record a local sample of up to ten seconds and play it back through
the selected output device. The sample includes the browser's selected echo
cancellation, noise suppression, and gain processing. The local preview graph
also applies the effective microphone gate to the recorded sample, so the
listen-back reflects whether quiet input is removed. Recordings remain in
browser memory, are replaced when a new check starts, and are released when the
settings page closes.

The preview does not interrupt an active call. It restarts after an input-device
or capture-processing change and releases its track and audio graph when the
user leaves the settings section. A denied or unavailable microphone produces
an inline error with a retry action. If a saved microphone disappears or fails,
dSpeak uses the browser system default without deleting the user's preference.
The unavailable preference remains visible in the selector. Device connection
changes refresh the list automatically.

## Active calls

After 400 milliseconds without qualifying microphone activity, dSpeak suspends
the sender but keeps capture and level analysis active. Speech can therefore
reopen transmission without reacquiring the device.

- On the SFU route, dSpeak locally pauses the mediasoup microphone producer.
- On Direct and Mesh routes, dSpeak deactivates microphone RTP encoding for each
  peer.

Remote receiving preferences do not change when the local gate opens or closes.
If an active microphone track ends unexpectedly, dSpeak attempts to restore
capture with the system default while retaining the preferred device ID. While
fallback capture is active, debounced media-device changes check whether the
exact preferred input has returned. dSpeak acquires and publishes the returning
microphone before stopping fallback capture, preserving the call, mute state,
processing preferences, and media topology. Permission failures are never
automatically retried, and dSpeak does not guess device identity from labels.
