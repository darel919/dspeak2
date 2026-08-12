import { listen } from "@tauri-apps/api/event";
import { useRuntimeStore } from "~/stores/runtime";

export function useDesktopTray() {
  const runtimeStore = useRuntimeStore();

  function setup() {
    if (!runtimeStore.isTauri) return;

    listen("tray:mute-toggle", () => {
      useVoiceStore().toggleMic();
    });

    listen("tray:join-last", () => {
      const router = useRouter();
      router.push("/voice/last-channel");
    });
  }

  function updatePresence(status: string) {
    if (!runtimeStore.isTauri) return;
    const { invoke } = require("@tauri-apps/api/core");
    invoke("set_tray_presence", { status });
  }

  return { setup, updatePresence };
}
