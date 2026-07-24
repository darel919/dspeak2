import { usePocketBaseAdmin } from "./pocketbase.js";

async function findMediaUserState(pb, filter) {
  try {
    return await pb.collection("dspeak_users_state").getFirstListItem(filter);
  } catch (error) {
    if (error?.status === 404 || error?.response?.status === 404) return null;
    throw error;
  }
}

export async function persistMediaPresence(room) {
  const pb = await usePocketBaseAdmin();
  const userIds = [
    ...new Set(
      [...room.sessions.values()].map((session) => String(session.userId)),
    ),
  ];
  await pb
    .collection("dspeak_rooms_channels")
    .update(room.id, { inRoom: userIds });
}

export async function createMediaUserState(session) {
  const pb = await usePocketBaseAdmin();
  const existing = await findMediaUserState(pb, `user = '${session.userId}'`);
  const state = {
    connected: session.room.id,
    muted: session.muted,
    deafened: session.deafened,
    audioBroadcasting: false,
    videoSharing: false,
    screenSharing: false,
  };
  if (existing)
    await pb.collection("dspeak_users_state").update(existing.id, state);
  else
    await pb.collection("dspeak_users_state").create({
      user: session.userId,
      ...state,
    });
}

export async function persistParticipantVoiceState(session) {
  const pb = await usePocketBaseAdmin();
  const existing = await findMediaUserState(
    pb,
    `user = '${session.userId}' && connected = '${session.room.id}'`,
  );
  if (existing)
    await pb.collection("dspeak_users_state").update(existing.id, {
      muted: session.muted,
      deafened: session.deafened,
    });
}

export async function removeMediaUserState(userId, channelId) {
  const pb = await usePocketBaseAdmin();
  const existing = await findMediaUserState(
    pb,
    `user = '${userId}' && connected = '${channelId}'`,
  );
  if (existing) await pb.collection("dspeak_users_state").delete(existing.id);
}
