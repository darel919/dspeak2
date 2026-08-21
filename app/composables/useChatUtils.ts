import { profileAssetUrl } from "../shared/profile-assets.ts";
import type {
  ChatMessageInput,
  ChatUserInput,
} from "../shared/types/composables.ts";
import { isExternalString } from "../shared/types/boundary.ts";
import type { ExternalField } from "~~/shared/types/external.ts";

export const useChatUtils = () => {
  function formatChatTime(dateString: string | number | Date) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return "Just now";
    } else if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }

  function formatChatDisplayTime(dateString: string | number | Date) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const pad = (n: number) => n.toString().padStart(2, "0");

    const hour12 = date.getHours() % 12 || 12;
    const min = pad(date.getMinutes());
    const ampm = date.getHours() < 12 ? "am" : "pm";
    const timeStr = hour12 + "." + min + ampm;

    if (date.toDateString() === now.toDateString()) {
      return timeStr;
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return days[date.getDay()] + " " + timeStr;
    }

    if (diffDays < 7) {
      return date.getMonth() + 1 + "/" + date.getDate() + " " + timeStr;
    }

    return (
      date.getFullYear() +
      "/" +
      (date.getMonth() + 1) +
      "/" +
      date.getDate() +
      " " +
      timeStr
    );
  }

  function formatFullDate(dateString: string | number | Date) {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });
  }

  function getAvatarUrl(avatarPath: string | null | undefined) {
    return profileAssetUrl(avatarPath) || "";
  }

  function validateMessage(content: ExternalField) {
    if (!isExternalString(content) || !content) {
      return { valid: false, error: "Message content is required" };
    }

    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: "Message cannot be empty" };
    }

    if (trimmed.length > 1000) {
      return {
        valid: false,
        error: "Message is too long (max 1000 characters)",
      };
    }

    return { valid: true, content: trimmed };
  }

  function generateTempId(userId = "") {
    const ts = Date.now();
    return `msg_${userId ? userId + "_" : ""}${ts}`;
  }

  function isUserMentioned(message: string, userId: string) {
    if (!message || !userId) return false;

    const mentionPattern = new RegExp(`@${userId}\\b`, "i");
    return mentionPattern.test(message);
  }

  function shouldGroupMessages(
    prevMessage: ChatMessageInput,
    currentMessage: ChatMessageInput,
  ) {
    if (!prevMessage || !currentMessage) return false;

    if (
      prevMessage.sender?.id === undefined ||
      currentMessage.sender?.id === undefined ||
      prevMessage.sender.id !== currentMessage.sender.id
    )
      return false;

    const timeDiff =
      new Date(String(currentMessage.created || "")).getTime() -
      new Date(String(prevMessage.created || "")).getTime();
    if (timeDiff > 5 * 60 * 1000) return false;

    return true;
  }

  function getUserDisplayName(user: ChatUserInput, currentUserId: string) {
    if (!user) return "Unknown User";

    if (user.id === currentUserId) return "You";

    return user.name || user.email || `User ${user.id.slice(0, 8)}`;
  }

  async function copyToClipboard(text: string) {
    if (!import.meta.client) return false;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      return false;
    }
  }

  function debounce(func: (...args: unknown[]) => void, delay: number) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    return (...args: unknown[]) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func(...args), delay);
    };
  }

  return {
    formatChatTime,
    formatChatDisplayTime,
    formatFullDate,
    getAvatarUrl,
    validateMessage,
    generateTempId,
    isUserMentioned,
    shouldGroupMessages,
    getUserDisplayName,
    copyToClipboard,
    debounce,
  };
};
