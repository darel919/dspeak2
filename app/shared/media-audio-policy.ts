import { getAudioBitrateBps } from "./voice-transport.ts";
import { isExternalNumber, isExternalString } from "./types/boundary.ts";

function audioBitrateValue<T>(value: T): number | string | null | undefined {
  return isExternalNumber(value) || isExternalString(value) ? value : undefined;
}

export function createMediaAudioPolicy({
  channelsStore,
  settingsStore,
  voiceStore,
}: {
  channelsStore: {
    getChannelById: (id: string) =>
      | {
          mediaPolicy?: {
            sharedAudioKbps?: unknown;
            microphoneKbps?: unknown;
            hdAudio?: unknown;
          } | null;
        }
      | null
      | undefined;
  };
  settingsStore: { systemAudioBitrate?: unknown };
  voiceStore: { currentChannelId: string | null };
}) {
  function getEffectiveAudioBitrate(source: string) {
    const channel = voiceStore.currentChannelId
      ? channelsStore.getChannelById(voiceStore.currentChannelId)
      : null;
    const channelBitrate =
      source === "screen-audio"
        ? channel?.mediaPolicy?.sharedAudioKbps
        : channel?.mediaPolicy?.microphoneKbps;
    return getAudioBitrateBps(
      source,
      audioBitrateValue(channelBitrate),
      audioBitrateValue(settingsStore.systemAudioBitrate),
    );
  }

  function getAudioStereo(source: string) {
    if (source === "screen-audio") return true;
    if (!voiceStore.currentChannelId) return false;
    return (
      channelsStore.getChannelById(voiceStore.currentChannelId)?.mediaPolicy
        ?.hdAudio === true
    );
  }

  return { getAudioStereo, getEffectiveAudioBitrate };
}
