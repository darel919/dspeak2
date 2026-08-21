import { STORAGE_KEYS } from "~/const/storage";
import {
  isExternalRecord,
  isExternalString,
} from "../shared/types/boundary.ts";
interface NotificationMessage {
  id?: string;
  content?: string;
  roomId?: string;
  sender?: { id?: string; name?: string } | string | null;
}

class NotificationManager {
  isSupported: boolean;
  permission: NotificationPermission;
  isEnabled: boolean;
  initialized: boolean;
  constructor() {
    this.isSupported = false;
    this.permission = "default";
    this.isEnabled = false;
    this.initialized = false;

    this.init();
  }

  init() {
    if (!import.meta.client) return;

    this.isSupported = "Notification" in window;
    if (this.isSupported) {
      this.permission = Notification.permission;

      const savedPreference = localStorage.getItem(
        STORAGE_KEYS.notificationsEnabled,
      );
      if (savedPreference !== null) {
        this.isEnabled =
          JSON.parse(savedPreference) && Notification.permission === "granted";
      } else {
        this.isEnabled = Notification.permission === "granted";
      }
    }

    this.initialized = true;
  }

  async requestPermission() {
    if (!this.isSupported) {
      throw new Error("Notifications are not supported in this browser");
    }

    if (this.permission === "granted") {
      return true;
    }

    try {
      const result = await Notification.requestPermission();
      this.permission = result;
      this.isEnabled = result === "granted";

      localStorage.setItem(
        STORAGE_KEYS.notificationsEnabled,
        JSON.stringify(this.isEnabled),
      );

      return result === "granted";
    } catch (error) {
      console.error("Error requesting notification permission:", error);
      return false;
    }
  }

  showNotification(title: string, options: NotificationOptions = {}) {
    if (!this.isEnabled || !this.isSupported) {
      return null;
    }

    try {
      const notification = new Notification(title, {
        icon: "/favicon-32x32.png",
        badge: "/favicon-16x16.png",
        ...options,
      });

      setTimeout(() => {
        notification.close();
      }, 5000);

      return notification;
    } catch (error) {
      console.error("[NotificationManager] Error showing notification:", error);
      return null;
    }
  }

  showMessageNotification(
    message: NotificationMessage,
    roomName: string | undefined,
    currentUserId: string | undefined,
  ) {
    let storedUserData = null;
    if (!currentUserId) {
      try {
        const userDataRaw = localStorage.getItem("userData");
        storedUserData = userDataRaw ? JSON.parse(userDataRaw) : null;
      } catch (e) {
        console.warn("[NotificationManager] Could not read stored user id:", e);
      }
    }

    const viewerId = currentUserId || storedUserData?.id;
    const sender = message?.sender;
    const senderId = isExternalRecord(sender) ? sender.id : sender;
    if (viewerId && senderId && String(senderId) === String(viewerId)) {
      return null;
    }

    if (!this.isEnabled) {
      return null;
    }

    const title = roomName ? `New message in ${roomName}` : "New message";
    const senderName = isExternalRecord(sender)
      ? sender.name || "Someone"
      : isExternalString(sender)
        ? sender
        : "Someone";
    const body = `${senderName}: ${message.content || "New message"}`;

    this.playNotificationSound();

    return this.showNotification(title, {
      body: body.length > 100 ? body.substring(0, 97) + "..." : body,
      tag: `message-${message.id}`,
      data: {
        messageId: message.id,
        roomId: message.roomId || null,
        senderId,
      },
      requireInteraction: false,
    });
  }

  playNotificationSound() {
    try {
      const audioContextConstructor =
        Object.getOwnPropertyDescriptor(globalThis, "AudioContext")?.value ||
        Object.getOwnPropertyDescriptor(globalThis, "webkitAudioContext")
          ?.value;
      if (audioContextConstructor instanceof Function) {
        const audioContext = new audioContextConstructor();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(
          600,
          audioContext.currentTime + 0.1,
        );

        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(
          0.01,
          audioContext.currentTime + 0.2,
        );

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
      }
    } catch (error) {
      console.error(
        "[NotificationManager] Error playing notification sound:",
        error,
      );
    }
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    if (enabled && this.permission !== "granted") {
      const granted = await this.requestPermission();
      if (!granted) return false;
    }

    this.isEnabled = enabled && this.permission === "granted";

    localStorage.setItem(
      STORAGE_KEYS.notificationsEnabled,
      JSON.stringify(this.isEnabled),
    );

    return this.isEnabled;
  }

  shouldShowNotification() {
    return true;
  }
}

const notificationManager = new NotificationManager();

export default notificationManager;
