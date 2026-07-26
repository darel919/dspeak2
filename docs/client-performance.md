# Client performance policy

dSpeak preserves call and messaging features across hardware classes by reducing
background and diagnostic work before reducing audio quality.

## Runtime budgets

- Normal RTC summaries run every 5 seconds while a call is visible.
- Full per-stream RTP sampling runs every second only while RTC diagnostics are
  open.
- Hidden tabs sample RTC summaries every 15 seconds.
- Local microphone detection stays responsive because it owns speaking and gate
  behavior.
- Remote microphone detection runs every 120 milliseconds while visible and
  every 300 milliseconds while hidden.
- Remote video reception pauses while the document is hidden. Camera reception
  resumes when visible, and screen reception restores the user's explicit
  choice.
- Chat renders the latest 200 messages initially and adds older messages in
  100-message windows.
- Reactive chat memory retains at most 1,000 messages for the active channel,
  300 for an inactive channel, and 8 channels.

Persistent chat history remains owned by IndexedDB and the server. The reactive
limits are not a retention policy.

## Performance acceptance

Measure release candidates with one, two, and four participants on both a
low-resource laptop and a current laptop.

Record:

- Browser process CPU after five minutes of an audio-only call
- Browser process memory after joining and leaving ten calls
- JavaScript heap after a 60-minute call
- Audio concealment, discarded packets, jitter-buffer output, and emitted sample
  counters
- Video decoded frames, dropped frames, and quality-limitation reasons
- Long tasks while scrolling a channel with at least 1,000 cached messages

Tests and builds validate lifecycle contracts but do not prove device audio,
decoder, GPU, or deployed network behavior. Complete the acceptance pass with
two real browser clients over both SFU and P2P.
