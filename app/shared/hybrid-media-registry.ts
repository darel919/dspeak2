import { RemoteMediaRegistry } from "./remote-media-registry.ts";
import type { Ref } from "vue";
import type { AttenuationReportInput } from "./media-attenuation-reporter.ts";
import type {
  RegistryAttenuation,
  RegistryEntry,
  RemoteMediaEntry,
} from "./types/hybrid-media-registry.ts";

export function createHybridMediaRegistry({
  audioFeeds,
  videoFeeds,
  getAttenuation,
  voiceStore,
  settingsStore,
  getActiveProvider,
  getSfu,
  getP2pMesh,
  error,
  playbackState,
  mediaConnectionState,
  iceConnectedBoth,
  setConnectionPhase,
  getAttenuationReporter,
}: {
  audioFeeds: Ref<Map<string, RemoteMediaEntry>>;
  videoFeeds: Ref<Map<string, RemoteMediaEntry>>;
  getAttenuation: (
    entry: Record<string, unknown>,
  ) => RegistryAttenuation | null;
  voiceStore: {
    getTrackVolume: (userId: string, source: string) => number;
    deafened: boolean;
    connectedUsers: Map<string, { speaking?: boolean }>;
    updateUserSpeaking: (userId: string, speaking: boolean) => void;
  };
  settingsStore: {
    outputDeviceId: string | null;
    broadcastMode: boolean;
  };
  getActiveProvider: () => string | null;
  getSfu: () => {
    setRemoteReceiving?: (
      userId: string | undefined,
      source: string,
      receiving: boolean,
    ) => unknown;
    connectionState?: () => { ready?: boolean };
  } | null;
  getP2pMesh: () => {
    setRemoteReceiving?: (
      userId: string | undefined,
      source: string,
      receiving: boolean,
    ) => unknown;
    isMediaReady?: () => boolean;
  } | null;
  error: Ref<string | null>;
  playbackState: Ref<string>;
  mediaConnectionState: Ref<string>;
  iceConnectedBoth: Ref<boolean>;
  setConnectionPhase: (
    phase: string,
    details?: Record<string, unknown>,
  ) => void;
  getAttenuationReporter: () => {
    report: (state: AttenuationReportInput) => void;
  } | null;
}) {
  return new RemoteMediaRegistry({
    audioFeeds,
    videoFeeds,
    getVolume: (userId: string, source: string) =>
      voiceStore.getTrackVolume(userId, source),
    getOutputDevice: () => settingsStore.outputDeviceId,
    isDeafened: () => voiceStore.deafened,
    isBroadcastMode: () => settingsStore.broadcastMode,
    isAnyoneSpeaking: () =>
      [...voiceStore.connectedUsers.values()].some(
        (participant) => participant.speaking === true,
      ),
    onSpeaking: (userId: string, speaking: boolean) =>
      voiceStore.updateUserSpeaking(userId, speaking),
    getAttenuation,
    onVideoReceivingChange: (entry: RemoteMediaEntry, receiving: boolean) => {
      if (entry.provider === "sfu")
        Promise.resolve(
          getSfu()?.setRemoteReceiving?.(
            entry.userId == null ? undefined : String(entry.userId),
            entry.source,
            receiving,
          ),
        ).catch((receivingError: unknown) => {
          error.value =
            receivingError instanceof Error
              ? receivingError.message
              : "Remote media state change failed";
        });
      if (entry.provider === "p2p")
        getP2pMesh()?.setRemoteReceiving?.(
          entry.peerId == null ? undefined : String(entry.peerId),
          entry.source,
          receiving,
        );
    },
    onPlaybackState: ({ state }: { state: string }) => {
      playbackState.value = state;
      if (state === "blocked" || state === "output-blocked") {
        mediaConnectionState.value = "playback-blocked";
        setConnectionPhase("playback-blocked", { reason: state });
        iceConnectedBoth.value = false;
      } else if (
        state === "ready" &&
        mediaConnectionState.value === "playback-blocked"
      ) {
        const provider = getActiveProvider();
        const readiness =
          provider === "p2p"
            ? { ready: getP2pMesh()?.isMediaReady?.() === true }
            : provider === "sfu"
              ? getSfu()?.connectionState?.()
              : null;
        const ready = readiness?.ready === true;
        iceConnectedBoth.value = ready;
        mediaConnectionState.value = ready
          ? "media-flowing"
          : "transport-connecting";
      }
    },
    onEffectiveGain: (state: AttenuationReportInput) =>
      getAttenuationReporter()?.report(state),
  });
}
