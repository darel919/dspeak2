const THEMES = Object.freeze({
  default: {
    "voice-join": "/sounds/default_connect.ogg",
    "voice-leave": "/sounds/default_disconnect.ogg",
    "screen-start": [440, 554, 659],
    "screen-enter": [587, 784],
    "screen-exit": [784, 587],
  },
});

let context = null;
const activeAudio = new Set();

export function availableSystemSoundThemes() {
  return Object.keys(THEMES);
}

export function systemSoundAsset(event, theme = "default") {
  const value = THEMES[theme]?.[event];
  return typeof value === "string" ? value : null;
}

function volume(settings) {
  return Math.max(0, Math.min(1, Number(settings.systemSoundVolume) / 100));
}

async function playAsset(path, settings) {
  const audio = new Audio(path);
  audio.volume = volume(settings);
  if (settings.outputDeviceId && typeof audio.setSinkId === "function")
    await audio.setSinkId(settings.outputDeviceId).catch(() => {});
  activeAudio.add(audio);
  const cleanup = () => activeAudio.delete(audio);
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });
  await audio.play().catch(cleanup);
}

function playTone(notes, settings) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  context ||= new AudioContext();
  const start = context.currentTime;
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    const noteStart = start + index * 0.075;
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, volume(settings) * 0.12),
      noteStart + 0.012,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.14);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + 0.15);
  });
}

export function playSystemSound(event, settings) {
  if (!import.meta.client || settings.systemSoundsMuted) return;
  const sound = THEMES[settings.systemSoundTheme]?.[event];
  if (typeof sound === "string") return playAsset(sound, settings);
  if (Array.isArray(sound)) playTone(sound, settings);
}
