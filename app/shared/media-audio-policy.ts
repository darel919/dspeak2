import { getAudioBitrateBps } from "./voice-transport.ts";

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
      channelBitrate,
      settingsStore.systemAudioBitrate,
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
