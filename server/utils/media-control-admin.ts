import type {
  MediaControlModerationResponse,
  MediaControlParticipantsResponse,
  MediaControlRequestOptions,
} from "../types/media-control-admin.ts";

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
): Promise<unknown> {
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
  const result = (await request(
    channelId,
    "participants",
  )) as MediaControlParticipantsResponse | null;
  return Boolean(
    result?.participants?.some(
      (participant) => String(participant.userId) === String(userId),
    ),
  );
}

export async function moderateVoiceParticipant(
  channelId: string,
  userId: string,
  targetChannelId: string | null = null,
): Promise<number> {
  const result = (await request(channelId, "moderate", {
    method: "POST",
    body: JSON.stringify({ userId, targetChannelId }),
  })) as MediaControlModerationResponse | null;
  return Number(result?.affected || 0);
}

export function disconnectVoiceParticipant(
  channelId: string,
  userId: string,
): Promise<number> {
  return moderateVoiceParticipant(channelId, userId, null);
}

export function updateActiveUserProfile(profile: unknown): Promise<boolean> {
  void profile;
  return Promise.resolve(false);
}
