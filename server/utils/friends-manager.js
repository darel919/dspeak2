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
