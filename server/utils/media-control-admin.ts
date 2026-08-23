import type { MediaControlRequestOptions } from "../types/media-control-admin.ts";
import { normalizeMediaPolicy } from "../../shared/media-policy.ts";
import {
  parseExternalNumber,
  parseExternalRecord,
  parseExternalString,
  type ExternalField,
} from "../../shared/types/external.ts";

function mediaControlUrl(channelId: string, action: string): string | null {
  const base = process.env.CF_MEDIA_CONTROL_URL;
  if (!base) return null;
  return new URL(
    `/v1/room/${encodeURIComponent(channelId)}/${action}`,
    base,
  ).toString();
}

async function request(
  channelId: string,
  action: string,
  options: MediaControlRequestOptions = {},
): Promise<ExternalField> {
  const url = mediaControlUrl(channelId, action);
  const token = process.env.CF_MEDIA_CONTROL_ADMIN_TOKEN;
  if (!url || !token) return null;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok)
    throw new Error(`Media control request failed: ${response.status}`);
  return response.json();
}

export async function isActiveVoiceParticipant(
  channelId: string,
  userId: string,
): Promise<boolean> {
  const result = parseExternalRecord(await request(channelId, "participants"));
  const participants = Array.isArray(result?.participants)
    ? result.participants
    : [];
  return participants.some((participant) => {
    const record = parseExternalRecord(participant);
    return parseExternalString(record?.userId) === userId;
  });
}

export async function moderateVoiceParticipant(
  channelId: string,
  userId: string,
  targetChannelId: string | null = null,
): Promise<number> {
  const result = parseExternalRecord(
    await request(channelId, "moderate", {
      method: "POST",
      body: JSON.stringify({ userId, targetChannelId }),
    }),
  );
  return parseExternalNumber(result?.affected) || 0;
}

export async function pushMediaPolicy(
  channelId: string,
  mediaPolicy: ExternalField,
): Promise<boolean> {
  const record = parseExternalRecord(mediaPolicy);
  if (!record) return false;
  try {
    const normalized = normalizeMediaPolicy(record);
    const result = parseExternalRecord(
      await request(channelId, "media-policy", {
        method: "POST",
        body: JSON.stringify({
          audioLatencyProfile: normalized.audioLatencyProfile,
          revision: normalized.revision,
          updatedAt: normalized.updatedAt ?? null,
        }),
      }),
    );
    return result?.accepted === true;
  } catch (error) {
    console.error("[MediaControlAdmin] Media policy push failed:", error);
    return false;
  }
}

export function disconnectVoiceParticipant(
  channelId: string,
  userId: string,
): Promise<number> {
  return moderateVoiceParticipant(channelId, userId, null);
}

export function updateActiveUserProfile(
  profile: ExternalField,
): Promise<boolean> {
  void profile;
  return Promise.resolve(false);
}
