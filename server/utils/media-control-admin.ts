function mediaControlUrl(channelId, action) {
  const base = process.env.CF_MEDIA_CONTROL_URL;
  if (!base) return null;
  return new URL(
    `/v1/room/${encodeURIComponent(channelId)}/${action}`,
    base,
  ).toString();
}

async function request(channelId, action, options = {} as any) {
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

export async function isActiveVoiceParticipant(channelId, userId) {
  const result = await request(channelId, "participants");
  return Boolean(
    result?.participants?.some(
      (participant) => String(participant.userId) === String(userId),
    ),
  );
}

export async function moderateVoiceParticipant(
  channelId,
  userId,
  targetChannelId = null,
) {
  const result = await request(channelId, "moderate", {
    method: "POST",
    body: JSON.stringify({ userId, targetChannelId }),
  });
  return Number(result?.affected || 0);
}

export function disconnectVoiceParticipant(channelId, userId) {
  return moderateVoiceParticipant(channelId, userId, null);
}

export function updateActiveUserProfile() {
  return false;
}
