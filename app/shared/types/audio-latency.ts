export const AUDIO_QUANTUM_US_VALUES = [2500, 5000, 10000] as const;

export type AudioQuantumUs = (typeof AUDIO_QUANTUM_US_VALUES)[number];

import { isExternalRecord, type ExternalObject } from "./boundary.ts";

export const COMPATIBILITY_AUDIO_QUANTUM_US: AudioQuantumUs = 10000;

export interface AudioLatencyCapabilitiesV1 {
  version: 1;
  nativeAudioEngine: boolean;
  restrictedLowDelayOpus: boolean;
  captureQuantaUs: readonly AudioQuantumUs[];
  encodeFrameDurationsUs: readonly AudioQuantumUs[];
  decodeFrameDurationsUs: readonly AudioQuantumUs[];
  renderQuantaUs: readonly AudioQuantumUs[];
}

export function compatibilityAudioLatencyCapabilities(): AudioLatencyCapabilitiesV1 {
  return {
    version: 1,
    nativeAudioEngine: false,
    restrictedLowDelayOpus: false,
    captureQuantaUs: [COMPATIBILITY_AUDIO_QUANTUM_US],
    encodeFrameDurationsUs: [COMPATIBILITY_AUDIO_QUANTUM_US],
    decodeFrameDurationsUs: [COMPATIBILITY_AUDIO_QUANTUM_US],
    renderQuantaUs: [COMPATIBILITY_AUDIO_QUANTUM_US],
  };
}

function normalizeQuanta(value: readonly unknown[]): AudioQuantumUs[] {
  const present = new Set<unknown>(value);
  return AUDIO_QUANTUM_US_VALUES.filter((quantum) => present.has(quantum));
}

function quantaField(
  source: ExternalObject,
  key: string,
): readonly AudioQuantumUs[] {
  const raw = source[key];
  if (!Array.isArray(raw)) return [COMPATIBILITY_AUDIO_QUANTUM_US];
  const quanta = normalizeQuanta(raw);
  return quanta.length ? quanta : [COMPATIBILITY_AUDIO_QUANTUM_US];
}

export function normalizeAudioLatencyCapabilities<T>(
  value: T,
): AudioLatencyCapabilitiesV1 {
  const source = isExternalRecord(value) ? value : null;
  if (!source || source.version !== 1)
    return compatibilityAudioLatencyCapabilities();
  return {
    version: 1,
    nativeAudioEngine: source.nativeAudioEngine === true,
    restrictedLowDelayOpus: source.restrictedLowDelayOpus === true,
    captureQuantaUs: quantaField(source, "captureQuantaUs"),
    encodeFrameDurationsUs: quantaField(source, "encodeFrameDurationsUs"),
    decodeFrameDurationsUs: quantaField(source, "decodeFrameDurationsUs"),
    renderQuantaUs: quantaField(source, "renderQuantaUs"),
  };
}

export function effectiveAudioQuantumUs(
  capabilities: AudioLatencyCapabilitiesV1,
): AudioQuantumUs {
  const common = new Set<AudioQuantumUs>(AUDIO_QUANTUM_US_VALUES);
  for (const stage of [
    capabilities.captureQuantaUs,
    capabilities.encodeFrameDurationsUs,
    capabilities.decodeFrameDurationsUs,
    capabilities.renderQuantaUs,
  ]) {
    for (const quantum of Array.from(common))
      if (!stage.includes(quantum)) common.delete(quantum);
  }
  if (!common.size) return COMPATIBILITY_AUDIO_QUANTUM_US;
  return AUDIO_QUANTUM_US_VALUES.find((quantum) => common.has(quantum))!;
}
