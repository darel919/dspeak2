import { db } from "../db/client.js";
import { friends, profiles } from "../db/schema/index.js";
import { eq, and, or, desc, asc, inArray } from "drizzle-orm";
import { sameOriginAvatarPath } from "../../shared/avatar-path.js";
import { publicDisplayName } from "../../shared/user-profile.js";

export async function getFriendsList(userId) {
  const friendships = await db
    .select()
    .from(friends)
    .where(and(eq(friends.userId, userId), eq(friends.status, "accepted")))
    .orderBy(desc(friends.createdAt));

  const friendIds = friendships.map((f) => f.friendId);
  if (friendIds.length === 0) return [];

  const friendProfiles = await db
    .select()
    .from(profiles)
    .where(inArray(profiles.id, friendIds));

  const profileMap = new Map(friendProfiles.map((p) => [p.id, p]));

  return friendships.map((friendship) => {
    const profile = profileMap.get(friendship.friendId);
    return {
      id: friendship.friendId,
      name: profile ? publicDisplayName(profile) : "",
      display_name: profile?.displayName || "",
      handle: profile?.username || "",
      avatar: profile ? sameOriginAvatarPath(profile) : "",
      online: false,
      presence_status: "offline",
      friendshipId: friendship.id,
      createdAt: friendship.createdAt,
    };
  });
}

export async function getFriendRequests(userId, status = "pending") {
  const requests = await db
    .select()
    .from(friends)
    .where(and(eq(friends.friendId, userId), eq(friends.status, status)))
    .orderBy(desc(friends.createdAt));

  const requesterIds = [...new Set(requests.map((r) => r.userId))];
  const requesterProfiles = await db
    .select()
    .from(profiles)
    .where(inArray(profiles.id, requesterIds));

  const requesterMap = new Map(requesterProfiles.map((p) => [p.id, p]));

  return requests.map((req) => {
    const requester = requesterMap.get(req.userId);
    return {
      id: req.id,
      requesterId: req.userId,
      requester: requester
        ? {
            id: requester.id,
            name: publicDisplayName(requester),
            display_name: requester.displayName || "",
            handle: requester.username || "",
            avatar: sameOriginAvatarPath(requester),
          }
        : null,
      status: req.status,
      createdAt: req.createdAt,
    };
  });
}

export async function sendFriendRequest(requesterId, recipientHandle) {
  const recipient = await db
    .select()
    .from(profiles)
    .where(eq(profiles.username, recipientHandle))
    .limit(1);

  if (!recipient[0]) {
    throw new Error("User not found");
  }

  const recipientId = recipient[0].id;

  if (String(recipientId) === String(requesterId)) {
    throw new Error("Cannot add yourself as a friend");
  }

  const existing = await db
    .select()
    .from(friends)
    .where(
      or(
        and(eq(friends.userId, requesterId), eq(friends.friendId, recipientId)),
        and(eq(friends.userId, recipientId), eq(friends.friendId, requesterId)),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const existingFriendship = existing[0];
    if (existingFriendship.status === "accepted") {
      throw new Error("Already friends with this user");
    }
    if (existingFriendship.status === "pending") {
      const isRequester =
        String(existingFriendship.userId) === String(requesterId);
      if (!isRequester) {
        await respondToFriendRequest(existingFriendship.id, requesterId, true);
        return {
          id: existingFriendship.id,
          status: "accepted",
          accepted: true,
        };
      }
      return {
        id: existingFriendship.id,
        recipientId,
        recipient: {
          id: recipientId,
          name: publicDisplayName(recipient[0]),
          handle: recipient[0].username || "",
          avatar: sameOriginAvatarPath(recipient[0]),
        },
        status: existingFriendship.status,
        createdAt: existingFriendship.createdAt,
      };
    }
    if (existingFriendship.status === "blocked") {
      throw new Error("Unable to send friend request");
    }
    if (existingFriendship.status === "rejected") {
      await db.delete(friends).where(eq(friends.id, existingFriendship.id));
    }
  }

  const result = await db
    .insert(friends)
    .values({
      userId: requesterId,
      friendId: recipientId,
      status: "pending",
    })
    .returning();

  const request = result[0];

  return {
    id: request.id,
    recipientId,
    recipient: {
      id: recipientId,
      name: publicDisplayName(recipient[0]),
      handle: recipient[0].username || "",
      avatar: sameOriginAvatarPath(recipient[0]),
    },
    status: request.status,
    createdAt: request.createdAt,
  };
}

export async function respondToFriendRequest(requestId, userId, accept) {
  const request = await db
    .select()
    .from(friends)
    .where(eq(friends.id, requestId))
    .limit(1);

  if (!request[0]) {
    throw new Error("Friend request not found");
  }

  if (String(request[0].friendId) !== String(userId)) {
    throw new Error("Not authorized to respond to this request");
  }

  if (request[0].status !== "pending") {
    throw new Error("Friend request is no longer pending");
  }

  const newStatus = accept ? "accepted" : "rejected";
  if (accept)
    await db
      .update(friends)
      .set({ status: newStatus })
      .where(eq(friends.id, requestId));
  else await db.delete(friends).where(eq(friends.id, requestId));

  return {
    id: requestId,
    status: newStatus,
  };
}

export async function getFriendshipStatus(userId, otherUserId) {
  if (String(userId) === String(otherUserId)) {
    return { status: "self" };
  }

  const friendship = await db
    .select()
    .from(friends)
    .where(
      or(
        and(eq(friends.userId, userId), eq(friends.friendId, otherUserId)),
        and(eq(friends.userId, otherUserId), eq(friends.friendId, userId)),
      ),
    )
    .limit(1);

  if (friendship.length === 0) {
    return { status: "none" };
  }

  const f = friendship[0];

  if (f.status === "accepted") {
    return { status: "friends", friendshipId: f.id };
  }

  if (f.status === "pending") {
    const isRequester = String(f.userId) === String(userId);
    return {
      status: isRequester ? "request-sent" : "request-received",
      friendshipId: f.id,
    };
  }

  if (f.status === "blocked") {
    return { status: "blocked" };
  }

  return { status: "none" };
}

export async function getMutualFriends(userId, otherUserId) {
  const userFriendships = await db
    .select()
    .from(friends)
    .where(and(eq(friends.userId, userId), eq(friends.status, "accepted")));

  const otherFriendships = await db
    .select()
    .from(friends)
    .where(
      and(eq(friends.userId, otherUserId), eq(friends.status, "accepted")),
    );

  const userFriendIds = new Set(
    userFriendships
      .map((f) => f.friendId)
      .filter((id) => String(id) !== String(otherUserId)),
  );

  const mutualFriendIds = otherFriendships
    .map((f) => f.friendId)
    .filter((id) => userFriendIds.has(id));

  if (mutualFriendIds.length === 0) return [];

  const mutualProfiles = await db
    .select()
    .from(profiles)
    .where(inArray(profiles.id, mutualFriendIds));

  const profileMap = new Map(mutualProfiles.map((p) => [p.id, p]));

  return mutualFriendIds.map((id) => {
    const profile = profileMap.get(id);
    return {
      id,
      name: profile ? publicDisplayName(profile) : "",
      display_name: profile?.displayName || "",
      handle: profile?.username || "",
      avatar: profile ? sameOriginAvatarPath(profile) : "",
      online: false,
      presence_status: "offline",
    };
  });
}

export async function sendFriendRequestById(requesterId, recipientId) {
  if (String(requesterId) === String(recipientId)) {
    throw new Error("Cannot add yourself as a friend");
  }

  const recipient = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, recipientId))
    .limit(1);

  if (!recipient[0]) {
    throw new Error("User not found");
  }

  const existing = await db
    .select()
    .from(friends)
    .where(
      or(
        and(eq(friends.userId, requesterId), eq(friends.friendId, recipientId)),
        and(eq(friends.userId, recipientId), eq(friends.friendId, requesterId)),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const existingFriendship = existing[0];
    if (existingFriendship.status === "accepted") {
      throw new Error("Already friends with this user");
    }
    if (existingFriendship.status === "pending") {
      const isRequester =
        String(existingFriendship.userId) === String(requesterId);
      if (isRequester) {
        throw new Error("Friend request already sent");
      }
      await respondToFriendRequest(existingFriendship.id, requesterId, true);
      return { id: existingFriendship.id, status: "accepted", accepted: true };
    }
    if (existingFriendship.status === "blocked") {
      throw new Error("Unable to send friend request");
    }
    if (existingFriendship.status === "rejected") {
      await db.delete(friends).where(eq(friends.id, existingFriendship.id));
    }
  }

  const result = await db
    .insert(friends)
    .values({
      userId: requesterId,
      friendId: recipientId,
      status: "pending",
    })
    .returning();

  const request = result[0];

  return {
    id: request.id,
    recipientId,
    recipient: {
      id: recipientId,
      name: publicDisplayName(recipient[0]),
      handle: recipient[0].username || "",
      avatar: sameOriginAvatarPath(recipient[0]),
    },
    status: request.status,
    createdAt: request.createdAt,
  };
}

export async function getSentFriendRequests(userId) {
  const requests = await db
    .select()
    .from(friends)
    .where(and(eq(friends.userId, userId), eq(friends.status, "pending")))
    .orderBy(desc(friends.createdAt));

  const recipientIds = [...new Set(requests.map((r) => r.friendId))];
  const recipientProfiles = await db
    .select()
    .from(profiles)
    .where(inArray(profiles.id, recipientIds));

  const recipientMap = new Map(recipientProfiles.map((p) => [p.id, p]));

  return requests.map((req) => {
    const recipient = recipientMap.get(req.friendId);
    return {
      id: req.id,
      recipientId: req.friendId,
      recipient: recipient
        ? {
            id: recipient.id,
            name: publicDisplayName(recipient),
            display_name: recipient.displayName || "",
            handle: recipient.username || "",
            avatar: sameOriginAvatarPath(recipient),
          }
        : null,
      status: req.status,
      createdAt: req.createdAt,
    };
  });
}

export async function cancelFriendRequest(requestId, userId) {
  const request = await db
    .select()
    .from(friends)
    .where(eq(friends.id, requestId))
    .limit(1);

  if (!request[0]) {
    throw new Error("Friend request not found");
  }

  if (String(request[0].userId) !== String(userId)) {
    throw new Error("Not authorized to cancel this request");
  }

  if (request[0].status !== "pending") {
    throw new Error("Friend request is no longer pending");
  }

  await db.delete(friends).where(eq(friends.id, requestId));
  return { success: true };
}

export async function removeFriend(userId, friendId) {
  const friendship = await db
    .select()
    .from(friends)
    .where(
      or(
        and(
          eq(friends.userId, userId),
          eq(friends.friendId, friendId),
          eq(friends.status, "accepted"),
        ),
        and(
          eq(friends.userId, friendId),
          eq(friends.friendId, userId),
          eq(friends.status, "accepted"),
        ),
      ),
    )
    .limit(1);

  if (!friendship[0]) {
    throw new Error("Friendship not found");
  }

  await db.delete(friends).where(eq(friends.id, friendship[0].id));
  return { success: true };
}
