import {
  isExternalRecord,
  isExternalString,
  type ExternalValue,
} from "~/shared/types/boundary.ts";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useRuntimeStore } from "~/stores/runtime";

type NotificationNavigationTarget =
  | { kind: "room"; roomId: string; channelId?: string | null }
  | { kind: "directMessage"; conversationId: string };

function isNotificationNavigationTarget(
  value: ExternalValue,
): value is NotificationNavigationTarget {
  if (!isExternalRecord(value)) return false;
  if (value.kind === "room")
    return isExternalString(value.roomId) && value.roomId.length > 0;
  if (value.kind === "directMessage")
    return (
      isExternalString(value.conversationId) && value.conversationId.length > 0
    );
  return false;
}

async function navigateToNotificationTarget(
  target: NotificationNavigationTarget,
) {
  if (target.kind === "directMessage") {
    await navigateTo(
      `/messages?conversationId=${encodeURIComponent(target.conversationId)}`,
    );
    return;
  }
  const path = target.channelId
    ? `/room/${encodeURIComponent(target.roomId)}/${encodeURIComponent(target.channelId)}`
    : `/room/${encodeURIComponent(target.roomId)}`;
  await navigateTo(path);
}

export function useDesktopTray() {
  const runtimeStore = useRuntimeStore();

  if (!runtimeStore.isTauri) return;

  void listen("tray:mute-toggle", () => {
    useVoiceStore().toggleMic();
  });

  void listen("tray:disconnect-voice", () => {
    void useVoiceStore().leaveVoiceChannel();
  });

  watch(
    () => {
      const voiceStore = useVoiceStore();
      const connected = voiceStore.connected;
      const channelId = voiceStore.currentChannelId;
      return {
        connected,
        label: connected
          ? (useChannelsStore().getChannelById(channelId)?.name ?? "")
          : "",
      };
    },
    (snapshot) => {
      invoke("set_tray_presence", { status: snapshot.label }).catch(() => {});
    },
    { immediate: true },
  );

  void listen("notification:navigate", () => {
    void (async () => {
      try {
        const target: ExternalValue = await invoke(
          "take_pending_notification_navigation",
        );
        if (!isNotificationNavigationTarget(target)) return;
        await navigateToNotificationTarget(target);
      } catch (error) {
        console.warn("[DesktopTray] Notification navigation failed:", error);
      }
    })();
  });
}
