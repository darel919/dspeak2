import { computed, unref } from "vue";
import { getVoiceConnectionStatus } from "../shared/voice-connection-status";

export function useVoiceConnectionStatus(voiceStore) {
  const session = computed(() => voiceStore.sfuComposable || null);
  const status = computed(() => {
    const currentSession = session.value;
    const topology = unref(currentSession?.topologyState);
    return getVoiceConnectionStatus({
      activeProvider: unref(currentSession?.activeProvider),
      connected: voiceStore.connected,
      connecting: voiceStore.connecting,
      mediaState: unref(currentSession?.mediaConnectionState),
      phase: unref(currentSession?.connectionPhase),
      topologyMode: topology?.mode,
    });
  });

  return { status };
}
