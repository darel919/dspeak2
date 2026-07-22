import { createCallWakeLockController } from "~/shared/call-wake-lock.js";

export function useCallWakeLock() {
  const voiceStore = useVoiceStore();
  let controller = null;
  let stopConnectedWatcher = null;

  onMounted(() => {
    controller = createCallWakeLockController({
      wakeLock: navigator.wakeLock,
      documentTarget: document,
    });
    stopConnectedWatcher = watch(
      () => voiceStore.connected,
      (connected) => void controller?.setConnected(connected),
      { immediate: true },
    );
  });

  onBeforeUnmount(() => {
    stopConnectedWatcher?.();
    stopConnectedWatcher = null;
    void controller?.dispose();
    controller = null;
  });
}
