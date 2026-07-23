# Microphone gate

The microphone gate stops transmitting background noise while keeping local
capture ready to detect speech. It affects microphone audio only. Camera,
screen share, shared audio, soundboards, and remote playback remain independent.

## Modes

- **Automatic:** Measures the local noise floor and chooses an opening threshold.
  This is the default when no preference has been saved. The estimator uses the
  quietest portion of a rolling five-second input window, so it can bootstrap
  from raw room noise and is not dependent on browser echo cancellation, noise
  suppression, or automatic gain control. While the gate is open, speech freezes
  upward adjustment. A continuously open signal can establish the initial floor
  only after remaining nearly level for three seconds.
- **Manual:** Uses a user-selected threshold from -60 dBFS to -20 dBFS.
- **Bypassed:** HD audio channels always bypass the gate. The saved setting is
  retained and applies again when the user joins a standard audio channel.

Echo cancellation, noise suppression, and automatic gain control remain
separate capture settings. Noise suppression can stay enabled in an HD audio
channel even though the gate is bypassed.

## Settings preview

Opening **Voice & Video** starts a local microphone preview. The preview shows:

- current input level;
- effective opening threshold; and
- open or closed gate state.

The preview never plays through the user's speakers and does not interrupt an
active call. It restarts after an input-device or capture-processing change and
releases its track and audio graph when the user leaves the settings section.
A denied or unavailable microphone produces an inline error with a retry action.
If a saved microphone disappears or fails, dSpeak retries once with the browser
system default. A successful fallback clears the stale saved device selection
and updates the selector. Device connection changes refresh the list
automatically.

## Active calls

After 400 milliseconds without qualifying microphone activity, dSpeak suspends
the sender but keeps capture and level analysis active. Speech can therefore
reopen transmission without reacquiring the device.

- On the SFU route, dSpeak locally pauses the mediasoup microphone producer.
- On Direct and Mesh routes, dSpeak deactivates microphone RTP encoding for each
  peer.

Remote receiving preferences do not change when the local gate opens or closes.
If an active microphone track ends unexpectedly, dSpeak clears the selected
device and attempts to restore capture once with the system default.
