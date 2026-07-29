import { listen } from "@tauri-apps/api/event";

export function useDesktopTray() {
  const isDesktop =
    typeof window !== "undefined" && window.__TAURI__ !== undefined;

  function setup() {
    if (!isDesktop) return;

    listen("tray:mute-toggle", () => {
      const voiceStore = useVoiceStore();
      voiceStore.toggleMute();
    });

    listen("tray:join-last", () => {
      const router = useRouter();
      router.push("/voice/last-channel");
    });
  }

  function updatePresence(status) {
    if (!isDesktop) return;
    const { invoke } = require("@tauri-apps/api/core");
    invoke("set_tray_presence", { status });
  }

  return { setup, updatePresence };
}
