import { usePocketBaseAdmin } from "./pocketbase.js";
import { getBoundedList } from "./pocketbase-query.js";

export async function getFriendsList(userId) {
  const pb = await usePocketBaseAdmin();
  let friendships;
  try {
    friendships = await getBoundedList(pb, "dspeak_friends", {
      filter: pb.filter(
        "(requester = {:userId} || recipient = {:userId}) && status = 'accepted'",
        { userId },
      ),
      expand: "requester,recipient",
    });
  } catch (error) {
    return [];
  }

  const friends = [];
  for (const friendship of friendships) {
    const friendId =
      String(friendship.requester) === String(userId)
        ? String(friendship.recipient)
        : String(friendship.requester);

    const profile =
      String(friendship.requester) === String(userId)
        ? friendship.expand?.recipient
        : friendship.expand?.requester;

    if (profile) {
      friends.push({
        id: friendId,
        name: profile.name || profile.username || "",
        display_name: profile.display_name || "",
        handle: profile.handle || "",
        avatar: profile.avatar || "",
        online: Boolean(profile.online),
        presence_status: profile.presence_status || "offline",
        friendshipId: friendship.id,
        createdAt: friendship.created,
      });
    }
  }

  return friends;
}

export async function getFriendRequests(userId, status = "pending") {
  const pb = await usePocketBaseAdmin();
  let requests;
  try {
    requests = await getBoundedList(pb, "dspeak_friends", {
      filter: pb.filter("recipient = {:userId} && status = {:status}", {
        userId,
        status,
      }),
      expand: "requester",
      sort: "-created",
    });
  } catch (error) {
    return [];
  }

  return requests.map((req) => ({
    id: req.id,
    requesterId: String(req.requester),
    requester: req.expand?.requester
      ? {
          id: req.expand.requester.id,
          name:
            req.expand.requester.name || req.expand.requester.username || "",
          display_name: req.expand.requester.display_name || "",
          handle: req.expand.requester.handle || "",
          avatar: req.expand.requester.avatar || "",
        }
      : null,
    status: req.status,
    createdAt: req.created,
  }));
}

export async function sendFriendRequest(requesterId, recipientHandle) {
  const pb = await usePocketBaseAdmin();

  const recipient = await pb
    .collection("users")
    .getFirstListItem(
      pb.filter("handle = {:handle}", { handle: recipientHandle }),
    )
    .catch(() => null);

  if (!recipient) {
    throw new Error("User not found");
  }

  if (String(recipient.id) === String(requesterId)) {
    throw new Error("Cannot add yourself as a friend");
  }

  const existing = await pb
    .collection("dspeak_friends")
    .getList(1, 1, {
      filter: pb.filter(
        "(requester = {:user1} || recipient = {:user1}) && (requester = {:user2} || recipient = {:user2})",
        { user1: requesterId, user2: recipient.id },
      ),
    })
    .then((r) => r.items[0] || null)
    .catch(() => null);

  if (existing) {
    if (existing.status === "accepted") {
      throw new Error("Already friends with this user");
    }
    if (existing.status === "pending") {
      throw new Error("Friend request already pending");
    }
    if (existing.status === "blocked") {
      throw new Error("Unable to send friend request");
    }
  }

  const request = await pb.collection("dspeak_friends").create({
    requester: requesterId,
    recipient: recipient.id,
    status: "pending",
  });

  return {
    id: request.id,
    recipientId: recipient.id,
    recipient: {
      id: recipient.id,
      name: recipient.name || recipient.username || "",
      handle: recipient.handle || "",
      avatar: recipient.avatar || "",
    },
    status: request.status,
    createdAt: request.created,
  };
}

export async function respondToFriendRequest(requestId, userId, accept) {
  const pb = await usePocketBaseAdmin();
  const request = await pb.collection("dspeak_friends").getOne(requestId);

  if (String(request.recipient) !== String(userId)) {
    throw new Error("Not authorized to respond to this request");
  }

  if (request.status !== "pending") {
    throw new Error("Friend request is no longer pending");
  }

  const newStatus = accept ? "accepted" : "rejected";
  await pb
    .collection("dspeak_friends")
    .update(requestId, { status: newStatus });

  return {
    id: requestId,
    status: newStatus,
  };
}

export async function getFriendshipStatus(userId, otherUserId) {
  const pb = await usePocketBaseAdmin();

  if (String(userId) === String(otherUserId)) {
    return { status: "self" };
  }

  try {
    const friendship = await pb
      .collection("dspeak_friends")
      .getFirstListItem(
        pb.filter(
          "(requester = {:user1} || recipient = {:user1}) && (requester = {:user2} || recipient = {:user2})",
          { user1: userId, user2: otherUserId },
        ),
      )
      .catch(() => null);

    if (!friendship) {
      return { status: "none" };
    }

    if (friendship.status === "accepted") {
      return { status: "friends", friendshipId: friendship.id };
    }

    if (friendship.status === "pending") {
      const isRequester = String(friendship.requester) === String(userId);
      return {
        status: isRequester ? "request-sent" : "request-received",
        friendshipId: friendship.id,
      };
    }

    if (friendship.status === "blocked") {
      return { status: "blocked" };
    }

    return { status: "none" };
  } catch (error) {
    return { status: "none" };
  }
}

export async function getMutualFriends(userId, otherUserId) {
  const pb = await usePocketBaseAdmin();

  try {
    const userFriendships = await getBoundedList(pb, "dspeak_friends", {
      filter: pb.filter(
        "(requester = {:userId} || recipient = {:userId}) && status = 'accepted'",
        { userId },
      ),
      expand: "requester,recipient",
    });

    const otherFriendships = await getBoundedList(pb, "dspeak_friends", {
      filter: pb.filter(
        "(requester = {:userId} || recipient = {:userId}) && status = 'accepted'",
        { userId: otherUserId },
      ),
      expand: "requester,recipient",
    });

    const userFriendIds = new Set();
    for (const f of userFriendships) {
      const friendId =
        String(f.requester) === String(userId)
          ? String(f.recipient)
          : String(f.requester);
      if (friendId !== String(otherUserId)) {
        userFriendIds.add(friendId);
      }
    }

    const mutual = [];
    for (const f of otherFriendships) {
      const friendId =
        String(f.requester) === String(otherUserId)
          ? String(f.recipient)
          : String(f.requester);
      if (userFriendIds.has(friendId)) {
        const profile =
          String(f.requester) === String(otherUserId)
            ? f.expand?.recipient
            : f.expand?.requester;
        if (profile) {
          mutual.push({
            id: friendId,
            name: profile.name || profile.username || "",
            display_name: profile.display_name || "",
            handle: profile.handle || "",
            avatar: profile.avatar || "",
            online: Boolean(profile.online),
            presence_status: profile.presence_status || "offline",
          });
        }
      }
    }

    return mutual;
  } catch (error) {
    return [];
  }
}

export async function sendFriendRequestById(requesterId, recipientId) {
  const pb = await usePocketBaseAdmin();

  if (String(requesterId) === String(recipientId)) {
    throw new Error("Cannot add yourself as a friend");
  }

  const recipient = await pb
    .collection("users")
    .getOne(recipientId)
    .catch(() => null);

  if (!recipient) {
    throw new Error("User not found");
  }

  const existing = await pb
    .collection("dspeak_friends")
    .getList(1, 1, {
      filter: pb.filter(
        "(requester = {:user1} || recipient = {:user1}) && (requester = {:user2} || recipient = {:user2})",
        { user1: requesterId, user2: recipient.id },
      ),
    })
    .then((r) => r.items[0] || null)
    .catch(() => null);

  if (existing) {
    if (existing.status === "accepted") {
      throw new Error("Already friends with this user");
    }
    if (existing.status === "pending") {
      const isRequester = String(existing.requester) === String(requesterId);
      if (isRequester) {
        throw new Error("Friend request already sent");
      }
      // Other user sent us a request — accept it
      await respondToFriendRequest(existing.id, requesterId, true);
      return { id: existing.id, status: "accepted", accepted: true };
    }
    if (existing.status === "blocked") {
      throw new Error("Unable to send friend request");
    }
  }

  const request = await pb.collection("dspeak_friends").create({
    requester: requesterId,
    recipient: recipient.id,
    status: "pending",
  });

  return {
    id: request.id,
    recipientId: recipient.id,
    recipient: {
      id: recipient.id,
      name: recipient.name || recipient.username || "",
      handle: recipient.handle || "",
      avatar: recipient.avatar || "",
    },
    status: request.status,
    createdAt: request.created,
  };
}

export async function getSentFriendRequests(userId) {
  const pb = await usePocketBaseAdmin();
  let requests;
  try {
    requests = await getBoundedList(pb, "dspeak_friends", {
      filter: pb.filter("requester = {:userId} && status = 'pending'", {
        userId,
      }),
      expand: "recipient",
      sort: "-created",
    });
  } catch (error) {
    return [];
  }

  return requests.map((req) => ({
    id: req.id,
    recipientId: String(req.recipient),
    recipient: req.expand?.recipient
      ? {
          id: req.expand.recipient.id,
          name:
            req.expand.recipient.name || req.expand.recipient.username || "",
          display_name: req.expand.recipient.display_name || "",
          handle: req.expand.recipient.handle || "",
          avatar: req.expand.recipient.avatar || "",
        }
      : null,
    status: req.status,
    createdAt: req.created,
  }));
}

export async function cancelFriendRequest(requestId, userId) {
  const pb = await usePocketBaseAdmin();
  const request = await pb.collection("dspeak_friends").getOne(requestId);

  if (String(request.requester) !== String(userId)) {
    throw new Error("Not authorized to cancel this request");
  }

  if (request.status !== "pending") {
    throw new Error("Friend request is no longer pending");
  }

  await pb.collection("dspeak_friends").delete(requestId);
  return { success: true };
}

export async function removeFriend(userId, friendId) {
  const pb = await usePocketBaseAdmin();
  const friendship = await pb
    .collection("dspeak_friends")
    .getFirstListItem(
      pb.filter(
        "((requester = {:user1} && recipient = {:user2}) || (requester = {:user2} && recipient = {:user1})) && status = 'accepted'",
        { user1: userId, user2: friendId },
      ),
    )
    .catch(() => null);

  if (!friendship) {
    throw new Error("Friendship not found");
  }

  await pb.collection("dspeak_friends").delete(friendship.id);
  return { success: true };
}
