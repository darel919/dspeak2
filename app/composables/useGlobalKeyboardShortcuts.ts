import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useAuthStore } from "../stores/auth";
import { useVoiceStore } from "../stores/voice";

export function useGlobalKeyboardShortcuts() {
  const { register, setScope } = useKeyboardShortcuts();
  const authStore = useAuthStore();
  const router = useRouter();
  const route = useRoute();

  let cleanups: Array<() => void> = [];
  type VoiceStore = ReturnType<typeof useVoiceStore>;
  let voiceStorePromise: Promise<VoiceStore> | null = null;

  function loadVoiceStore() {
    voiceStorePromise ||= import("../stores/voice").then(({ useVoiceStore }) =>
      useVoiceStore(),
    );
    return voiceStorePromise;
  }

  function runVoiceAction(action: (voiceStore: VoiceStore) => void): void {
    if (!authStore.getUserData()) return;
    void loadVoiceStore()
      .then(action)
      .catch((error) => console.error("[Keyboard shortcuts]", error));
  }

  function init() {
    if (!import.meta.client) return;

    const runtimeStore = useRuntimeStore();

    cleanups = [
      register("toggle-mic", ["Mod+Shift+m"], () => {
        runVoiceAction((voiceStore) => voiceStore.toggleMic());
      }),

      register("toggle-deafen", ["Mod+Shift+d"], () => {
        runVoiceAction((voiceStore) => voiceStore.toggleDeafen());
      }),

      register("open-settings", ["Mod+,"], () => {
        router.push("/settings");
      }),

      register("navigate-home", ["Mod+1"], () => {
        router.push("/");
      }),

      register("prev-channel", ["Alt+ArrowUp"], () => {
        const currentPath = route.path;
        if (currentPath.startsWith("/room/")) {
          window.dispatchEvent(new CustomEvent("dspeak:prev-channel"));
        }
      }),

      register("next-channel", ["Alt+ArrowDown"], () => {
        const currentPath = route.path;
        if (currentPath.startsWith("/room/")) {
          window.dispatchEvent(new CustomEvent("dspeak:next-channel"));
        }
      }),

      register("open-devtools", ["Mod+Shift+i", "F12"], () => {
        if (!runtimeStore.isTauri) return false;

        void import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("desktop_open_devtools"))
          .catch((error) => {
            console.error("[DesktopDebug] DEVTOOLS_OPEN_FAILED", error);
          });
      }),

      register("toggle-rtc-debug", ["Mod+Shift+r"], () => {
        const visible = useState("rtc-summary-visible");
        visible.value = !visible.value;
      }),

      register("help-shortcuts", ["Mod+/", "Mod+?"], () => {
        const visible = useState("shortcuts-help-visible", () => false);
        visible.value = !visible.value;
      }),
    ];
  }

  function destroy() {
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups = [];
  }

  onScopeDispose(destroy);

  return {
    init,
    destroy,
    setScope,
  };
}
