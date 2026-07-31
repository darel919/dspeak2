import { defineStore } from "pinia";
import { hasTauriRuntimeMarker } from "../shared/desktop-capture.js";

export const useRuntimeStore = defineStore("runtime", () => {
  const initialized = ref(false);
  const isTauri = ref(false);

  async function initialize() {
    if (initialized.value) return isTauri.value;
    if (!import.meta.client) return false;

    let detected = hasTauriRuntimeMarker();
    if (!detected) {
      try {
        const { isTauri: detectTauri } = await import("@tauri-apps/api/core");
        detected = typeof detectTauri === "function" && detectTauri();
      } catch {
        detected = false;
      }
    }

    isTauri.value = detected;
    initialized.value = true;
    return detected;
  }

  return {
    initialized,
    isTauri,
    isBrowser: computed(() => initialized.value && !isTauri.value),
    initialize,
  };
});
