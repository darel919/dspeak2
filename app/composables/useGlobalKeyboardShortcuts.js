import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useVoiceStore } from "../stores/voice";
import { useAuthStore } from "../stores/auth";

export function useGlobalKeyboardShortcuts() {
  const { register, setScope } = useKeyboardShortcuts();
  const voiceStore = useVoiceStore();
  const authStore = useAuthStore();
  const router = useRouter();
  const route = useRoute();

  let cleanups = [];

  function init() {
    if (!import.meta.client) return;

    cleanups = [
      register("toggle-mic", ["Mod+Shift+m"], () => {
        if (authStore.getUserData()) {
          voiceStore.toggleMic();
        }
      }),

      register("toggle-deafen", ["Mod+Shift+d"], () => {
        if (authStore.getUserData()) {
          voiceStore.toggleDeafen();
        }
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
    cleanups = [];
  }

  onScopeDispose(destroy);

  return {
    init,
    destroy,
    setScope,
  };
}
