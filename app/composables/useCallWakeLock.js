import { useAuthStore } from "~/stores/auth";
import { createCallWakeLockController } from "~/shared/call-wake-lock.js";

export function useCallWakeLock() {
  const authStore = useAuthStore();
  let controller = null;
  let stopConnectedWatcher = null;
  let stopAuthWatcher = null;
  let mountGeneration = 0;
  let disposed = false;

  function disposeController() {
    stopConnectedWatcher?.();
    stopConnectedWatcher = null;
    void controller?.dispose();
    controller = null;
  }

  async function mountForUser(generation) {
    try {
      const { useVoiceStore } = await import("~/stores/voice");
      if (
        disposed ||
        generation !== mountGeneration ||
        !authStore.getUserData()?.id
      )
        return;
      const voiceStore = useVoiceStore();
      controller = createCallWakeLockController({
        wakeLock: navigator.wakeLock,
        documentTarget: document,
      });
      stopConnectedWatcher = watch(
        () => voiceStore.connected,
        (connected) => void controller?.setConnected(connected),
        { immediate: true },
      );
    } catch {
      disposeController();
    }
  }

  onMounted(() => {
    stopAuthWatcher = watch(
      () => authStore.getUserData()?.id,
      (userId) => {
        mountGeneration += 1;
        disposeController();
        if (userId) void mountForUser(mountGeneration);
      },
      { immediate: true },
    );
  });

  onBeforeUnmount(() => {
    disposed = true;
    mountGeneration += 1;
    stopAuthWatcher?.();
    stopAuthWatcher = null;
    disposeController();
  });
}
