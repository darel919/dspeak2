import {
  normalizeNotificationMode,
  messageMentionsHandle,
} from "./notification-policy.ts";

export const CHANNEL_POLICIES = Object.freeze({
  free: "free",
  send_restricted: "send_restricted",
  read_only: "read_only",
  moderator_only: "moderator_only",
});

function isChannelPolicy(value: unknown): value is ChannelPolicy {
  return (
    value === CHANNEL_POLICIES.free ||
    value === CHANNEL_POLICIES.send_restricted ||
    value === CHANNEL_POLICIES.read_only ||
    value === CHANNEL_POLICIES.moderator_only
  );
}

export const CHANNEL_POLICY_LABELS = Object.freeze({
  free: "Free for all",
  send_restricted: "Send restricted",
  read_only: "Read only",
  moderator_only: "Moderator only",
});

export const SLOW_MODE_OPTIONS = Object.freeze([
  { value: 0, label: "Off" },
  { value: 5, label: "5 seconds" },
  { value: 10, label: "10 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" },
  { value: 3600, label: "1 hour" },
]);

export function normalizeChannelPolicy(value: unknown) {
  return isChannelPolicy(value) ? value : CHANNEL_POLICIES.free;
}

export function normalizeSlowMode(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(3600, numeric)) : 0;
}

export function canSendInChannel({
  channelPolicy,
  isModeratorOrAbove,
  hasSendPermission,
}: {
  channelPolicy: unknown;
  isModeratorOrAbove: boolean;
  hasSendPermission: boolean;
}) {
  if (!channelPolicy || channelPolicy === CHANNEL_POLICIES.free) return true;
  if (channelPolicy === CHANNEL_POLICIES.read_only) return false;
  if (channelPolicy === CHANNEL_POLICIES.moderator_only)
    return isModeratorOrAbove;
  if (channelPolicy === CHANNEL_POLICIES.send_restricted)
    return hasSendPermission;
  return true;
}

export function isSlowModeCooldownActive(
  lastMessageAt: unknown,
  slowModeSeconds: unknown,
) {
  const messageTime = Number(lastMessageAt);
  const seconds = Number(slowModeSeconds);
  if (
    !Number.isFinite(messageTime) ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  )
    return false;
  return Date.now() - messageTime < seconds * 1000;
}

export function slowModeRemainingMs(
  lastMessageAt: unknown,
  slowModeSeconds: unknown,
) {
  const messageTime = Number(lastMessageAt);
  const seconds = Number(slowModeSeconds);
  if (
    !Number.isFinite(messageTime) ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  )
    return 0;
  return Math.max(0, seconds * 1000 - (Date.now() - messageTime));
}
import type { ChannelPolicy } from "./types/channel.ts";
