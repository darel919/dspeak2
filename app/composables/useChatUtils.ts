import { profileAssetUrl } from "../shared/profile-assets.ts";
import type {
  ChatMessageInput,
  ChatUserInput,
} from "../shared/types/composables.ts";

export const useChatUtils = () => {
  /**
   * Format a timestamp for display in chat
   */
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

  /**
   * Format a timestamp for chat display:
   * - Today: HH:mm
   * - Yesterday: ddd h:mmA (e.g. Thu 6.52pm)
   * - Last week: d/M (e.g. 8/8)
   * - Else: yyyy/M/d
   */
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

  /**
   * Format a full date for detailed views
   */
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

  /**
   * Get the protected avatar URL when a profile has one.
   * Missing avatars are rendered as initials by the caller.
   */
  function getAvatarUrl(avatarPath: string | null | undefined) {
    return profileAssetUrl(avatarPath) || "";
  }

  /**
   * Validate message content
   */
  function validateMessage(content: unknown) {
    if (!content || typeof content !== "string") {
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

  /**
   * Generate a temporary message ID for optimistic updates
   */
  function generateTempId(userId = "") {
    const ts = Date.now();
    return `msg_${userId ? userId + "_" : ""}${ts}`;
  }

  /**
   * Check if user is mentioned in message
   */
  function isUserMentioned(message: string, userId: string) {
    if (!message || !userId) return false;

    const mentionPattern = new RegExp(`@${userId}\\b`, "i");
    return mentionPattern.test(message);
  }

  /**
   * Check if two messages should be grouped (same sender, close in time)
   */
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

  /**
   * Get user display name with fallback
   */
  function getUserDisplayName(user: ChatUserInput, currentUserId: string) {
    if (!user) return "Unknown User";

    if (user.id === currentUserId) return "You";

    return user.name || user.email || `User ${user.id.slice(0, 8)}`;
  }

  /**
   * Copy text to clipboard with fallback
   */
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

  /**
   * Debounce function for typing indicators
   */
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
