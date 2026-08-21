import { isExternalString } from "./types/boundary.ts";

const THEMES = Object.freeze({
  default: {
    "voice-join": "/sounds/default_connect.ogg",
    "voice-leave": "/sounds/default_disconnect.ogg",
    "screen-start": [440, 554, 659],
    "screen-enter": [587, 784],
    "screen-exit": [784, 587],
  },
});

type SoundEvent =
  | "voice-join"
  | "voice-leave"
  | "screen-start"
  | "screen-enter"
  | "screen-exit";
export interface SoundSettings {
  systemSoundVolume: number;
  systemSoundTheme: keyof typeof THEMES;
  systemSoundsMuted: boolean;
  outputDeviceId?: string | null;
}

let context: AudioContext | null = null;
const activeAudio = new Set();

export function availableSystemSoundThemes() {
  return Object.keys(THEMES);
}

export function systemSoundAsset(
  event: SoundEvent,
  theme: keyof typeof THEMES = "default",
) {
  const value = THEMES[theme]?.[event];
  return isExternalString(value) ? value : null;
}

function volume(settings: SoundSettings) {
  return Math.max(0, Math.min(1, Number(settings.systemSoundVolume) / 100));
}

async function playAsset(path: string, settings: SoundSettings) {
  const audio = new Audio(path);
  audio.volume = volume(settings);
  if (settings.outputDeviceId && audio.setSinkId instanceof Function) {
    try {
      await audio.setSinkId(settings.outputDeviceId);
    } catch (error) {
      console.warn("[SystemSound] Selected output is unavailable", error);
      await audio.setSinkId("");
    }
  }
  activeAudio.add(audio);
  const cleanup = () => activeAudio.delete(audio);
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });
  await audio.play().catch(cleanup);
}

function playTone(notes: number[], settings: SoundSettings) {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return;
  context ||= new AudioContextConstructor();
  const audioContext = context;
  const start = audioContext.currentTime;
  notes.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    const noteStart = start + index * 0.075;
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, volume(settings) * 0.12),
      noteStart + 0.012,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.14);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + 0.15);
  });
}

export function playSystemSound(event: SoundEvent, settings: SoundSettings) {
  if (!import.meta.client || settings.systemSoundsMuted) return;
  const sound = THEMES[settings.systemSoundTheme]?.[event];
  if (isExternalString(sound)) return playAsset(sound, settings);
  if (Array.isArray(sound)) playTone(sound, settings);
}
