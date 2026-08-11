import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useAuthStore } from "../stores/auth";

export function useGlobalKeyboardShortcuts() {
  const { register, setScope } = useKeyboardShortcuts();
  const authStore = useAuthStore();
  const router = useRouter();
  const route = useRoute();

  let cleanups = [] as any;
  let voiceStorePromise = null;

  function loadVoiceStore() {
    voiceStorePromise ||= import("../stores/voice").then(({ useVoiceStore }) =>
      useVoiceStore(),
    );
    return voiceStorePromise;
  }

  function runVoiceAction(action) {
    if (!authStore.getUserData()) return;
    void loadVoiceStore()
      .then(action)
      .catch((error) => console.error("[Keyboard shortcuts]", error));
  }

  function init() {
    if (!import.meta.client) return;

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

      register("toggle-rtc-debug", ["Mod+Shift+i"], () => {
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
    cleanups = [] as any;
  }

  onScopeDispose(destroy);

  return {
    init,
    destroy,
    setScope,
  };
}
