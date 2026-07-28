import { requireAuthenticatedUser } from "../../../utils/authentication.js";
import { usePocketBaseAdmin } from "../../../utils/pocketbase.js";
import { deleteMatchingRecords } from "../../../utils/pocketbase-query.js";
import { disconnectVoiceParticipant } from "../../../utils/mediasoup-sfu.js";
import { enforceRateLimit } from "../../../utils/rate-limit.js";

const accountDeletionLocksKey = Symbol.for("dspeak.account-deletion-locks");

function accountDeletionLocks() {
  if (!globalThis[accountDeletionLocksKey])
    globalThis[accountDeletionLocksKey] = new Set();
  return globalThis[accountDeletionLocksKey];
}

async function deleteUserRecords(pb, collection, fieldName, userId) {
  return deleteMatchingRecords(
    pb,
    collection,
    pb.filter(`${fieldName} = {:user}`, { user: userId }),
  );
}

async function deleteAccount(pb, userId) {
  const voiceStates = await pb.collection("dspeak_users_state").getFullList({
    filter: pb.filter("user = {:user}", { user: userId }),
    fields: "id,connected",
  });
  await Promise.all(
    voiceStates.map(async (voiceState) => {
      if (voiceState.connected)
        await disconnectVoiceParticipant(voiceState.connected, userId);
      await pb.collection("dspeak_users_state").delete(voiceState.id);
    }),
  );

  const ownedRooms = await pb.collection("dspeak_rooms").getFullList({
    filter: pb.filter("owner = {:user}", { user: userId }),
    fields: "id",
  });

  await deleteUserRecords(pb, "dspeak_room_memberships", "user", userId);

  for (const room of ownedRooms) {
    const otherMembers = await pb
      .collection("dspeak_room_memberships")
      .getList(1, 1, {
        filter: pb.filter("room = {:room} && user != {:user}", {
          room: room.id,
          user: userId,
        }),
        fields: "user",
      });
    if (otherMembers.items[0]?.user) {
      await pb.collection("dspeak_rooms").update(room.id, {
        owner: otherMembers.items[0].user,
      });
    } else {
      await pb.collection("dspeak_rooms").delete(room.id);
    }
  }

  const ownedChannels = await pb
    .collection("dspeak_rooms_channels")
    .getFullList({
      filter: pb.filter("owner = {:user}", { user: userId }),
      fields: "id,room",
    });
  for (const channel of ownedChannels) {
    try {
      const room = await pb.collection("dspeak_rooms").getOne(channel.room, {
        fields: "owner",
      });
      if (room.owner !== userId)
        await pb.collection("dspeak_rooms_channels").update(channel.id, {
          owner: room.owner,
        });
    } catch (error) {
      if (error?.status !== 404 && error?.response?.status !== 404) throw error;
    }
  }

  const channelsWithPresence = await pb
    .collection("dspeak_rooms_channels")
    .getFullList({
      filter: pb.filter("inRoom = {:user}", { user: userId }),
      fields: "id,inRoom",
    });
  await Promise.all(
    channelsWithPresence.map((channel) =>
      pb.collection("dspeak_rooms_channels").update(channel.id, {
        inRoom: (channel.inRoom || []).filter(
          (participantId) => String(participantId) !== String(userId),
        ),
      }),
    ),
  );

  const messages = await pb.collection("dspeak_messages").getFullList({
    filter: pb.filter("sender = {:user}", { user: userId }),
    fields: "id",
  });
  await Promise.all(
    messages.map((message) =>
      pb.collection("dspeak_messages").update(message.id, {
        content: "[deleted]",
      }),
    ),
  );

  const readReceipts = await pb.collection("dspeak_messages").getFullList({
    filter: pb.filter("read_by ?= {:user}", { user: userId }),
    fields: "id,read_by",
  });
  await Promise.all(
    readReceipts.map((message) =>
      pb.collection("dspeak_messages").update(message.id, {
        read_by: (message.read_by || []).filter(
          (readerId) => String(readerId) !== String(userId),
        ),
      }),
    ),
  );

  await deleteUserRecords(
    pb,
    "dspeak_notification_preferences",
    "user",
    userId,
  );
  await deleteUserRecords(
    pb,
    "dspeak_room_notification_preferences",
    "user",
    userId,
  );
  await deleteUserRecords(pb, "dspeak_push_subscriptions", "user", userId);
  await deleteUserRecords(pb, "dspeak_bookmarks", "user", userId);
  await deleteUserRecords(pb, "dspeak_user_nicknames", "owner", userId);
  await deleteUserRecords(pb, "dspeak_friends", "requester", userId);
  await deleteUserRecords(pb, "dspeak_friends", "recipient", userId);
  await deleteUserRecords(pb, "dspeak_message_reactions", "user", userId);
  await deleteUserRecords(pb, "dspeak_message_revisions", "editor", userId);
  await deleteUserRecords(pb, "dspeak_notifications", "recipient", userId);
  await deleteUserRecords(pb, "dspeak_push_jobs", "recipient", userId);
  await deleteUserRecords(pb, "dspeak_room_soundboards", "uploader", userId);
  await deleteUserRecords(pb, "dspeak_chat_files", "uploader", userId);
  await deleteUserRecords(pb, "dspeak_pinned_messages", "pinned_by", userId);
  await deleteUserRecords(pb, "dspeak_room_invites", "created_by", userId);

  await pb.collection("users").update(userId, {
    name: "[deleted]",
    username: `deleted_${userId.slice(0, 8)}`,
    display_name: "",
    handle: "",
    avatar: "",
    email: "",
    online: false,
    presence_status: "offline",
    deleted_at: new Date().toISOString(),
  });

  await deleteUserRecords(pb, "dspeak_sessions", "user", userId);
  return { success: true };
}

export default defineEventHandler(async (event) => {
  const userId = await requireAuthenticatedUser(event);
  enforceRateLimit(event, "account-delete", userId, 3, 60 * 60 * 1000);

  const locks = accountDeletionLocks();
  if (locks.has(userId))
    throw createError({
      statusCode: 409,
      statusMessage: "Account deletion is already in progress",
    });

  locks.add(userId);
  try {
    return await deleteAccount(await usePocketBaseAdmin(), userId);
  } finally {
    locks.delete(userId);
  }
});
