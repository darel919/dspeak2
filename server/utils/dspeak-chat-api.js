export function createChatApiHandler(dependencies) {
  const {
    broadcastToChannel,
    broadcastToUser,
    canDeleteMessage,
    canViewMessageHistory,
    createError,
    enforceRateLimit,
    ensureMember,
    getBoundedList,
    getHeader,
    getQuery,
    isMessageOwner,
    parseBody,
    persistMessageNotifications,
    pocketBaseError,
    presentUser,
    requireAuthenticatedUser,
    requireRoomMember,
    requireValue,
    sendPushTest,
    setResponseStatus,
    usePocketBaseAdmin,
  } = dependencies;

  async function handleNotifications(event, pb, userId, suffix) {
    const body = event.method === "GET" ? {} : await parseBody(event);
    if (suffix === "notifications" && event.method === "GET") {
      const items = await pb
        .collection("dspeak_notifications")
        .getList(1, 100, {
          filter: `recipient = '${userId}'`,
          sort: "-created",
          expand: "actor,room,channel,message",
        });
      return items;
    }
    if (suffix === "notifications/read" && event.method === "POST") {
      const ids = Array.isArray(body.ids) ? body.ids.slice(0, 100) : [];
      const records = ids.length
        ? await getBoundedList(
            pb,
            "dspeak_notifications",
            {
              filter: ids.map((id) => `id = '${id}'`).join(" || "),
            },
            100,
          )
        : await getBoundedList(
            pb,
            "dspeak_notifications",
            {
              filter: `recipient = '${userId}' && read_at = null`,
            },
            500,
          );
      const readAt = new Date().toISOString();
      await Promise.all(
        records
          .filter((record) => String(record.recipient) === String(userId))
          .map((record) =>
            pb.collection("dspeak_notifications").update(record.id, {
              read_at: readAt,
            }),
          ),
      );
      broadcastToUser(String(userId), {
        type: "notifications_read",
        data: { ids },
      });
      return { success: true, readAt };
    }
    if (suffix === "notification-preferences") {
      const existing = await getBoundedList(
        pb,
        "dspeak_notification_preferences",
        { filter: `user = '${userId}'` },
        1,
      );
      if (event.method === "GET")
        return (
          existing[0] || {
            mode: "all",
            push: false,
            sound: true,
            previews: true,
            attenuation_override: { mode: "room", reductionPercent: 65 },
          }
        );
      if (event.method === "PUT") {
        const data = {
          user: userId,
          mode: ["all", "mentions", "muted"].includes(body.mode)
            ? body.mode
            : "all",
          push: Boolean(body.push),
          sound: body.sound !== false,
          previews: body.previews !== false,
          attenuation_override: body.attenuationOverride || {
            mode: "room",
            reductionPercent: 65,
          },
        };
        return existing[0]
          ? pb
              .collection("dspeak_notification_preferences")
              .update(existing[0].id, data)
          : pb.collection("dspeak_notification_preferences").create(data);
      }
    }
    if (suffix === "room-notification-preferences") {
      const roomId = requireValue(
        getQuery(event).roomId || body.roomId,
        "Room ID is required",
      );
      await requireRoomMember(
        pb,
        await pb.collection("dspeak_rooms").getOne(roomId),
        userId,
      );
      const existing = await getBoundedList(
        pb,
        "dspeak_room_notification_preferences",
        { filter: `user = '${userId}' && room = '${roomId}'` },
        1,
      );
      if (event.method === "GET")
        return (
          existing[0] || { room: roomId, mode: "all", push: null, sound: null }
        );
      if (event.method === "PUT") {
        const data = {
          user: userId,
          room: roomId,
          mode: ["all", "mentions", "muted"].includes(body.mode)
            ? body.mode
            : "all",
          push: body.push === null ? null : Boolean(body.push),
          sound: body.sound === null ? null : Boolean(body.sound),
        };
        return existing[0]
          ? pb
              .collection("dspeak_room_notification_preferences")
              .update(existing[0].id, data)
          : pb.collection("dspeak_room_notification_preferences").create(data);
      }
    }
    throw createError({
      statusCode: 404,
      statusMessage: "Notification endpoint not found",
    });
  }

  async function handleChat(event, suffix) {
    if (!suffix && event.method === "GET") return "dSpeak Chat";
    if (suffix === "socket" && event.method === "GET")
      throw createError({ statusCode: 426, statusMessage: "Upgrade Required" });
    const pb = await usePocketBaseAdmin();
    const userId = await requireAuthenticatedUser(event);

    if (
      suffix === "notifications" ||
      suffix === "notifications/read" ||
      suffix === "notification-preferences" ||
      suffix === "room-notification-preferences"
    )
      return handleNotifications(event, pb, userId, suffix);

    if (suffix === "unread" && event.method === "GET") {
      const rooms = await getBoundedList(pb, "dspeak_rooms", {
        filter: `members ~ '${userId}'`,
      });
      if (!rooms.length) return [];
      const channels = await getBoundedList(pb, "dspeak_rooms_channels", {
        filter: rooms.map((room) => `room = '${room.id}'`).join(" || "),
      });
      if (!channels.length) return [];
      const channelById = new Map(
        channels.map((channel) => [
          String(channel.id),
          {
            channelId: channel.id,
            roomId: channel.room,
            unreadCount: 0,
          },
        ]),
      );
      const messages = await getBoundedList(pb, "dspeak_messages", {
        filter: `(${channels
          .map((channel) => `room_channel = '${channel.id}'`)
          .join(" || ")}) && read_by !~ '${userId}'`,
        fields: "room_channel,read_by",
      });
      for (const message of messages) {
        const count = channelById.get(String(message.room_channel));
        if (count) count.unreadCount += 1;
      }
      return [...channelById.values()];
    }

    if (suffix === "messages" && event.method === "GET") {
      const channelId = requireValue(
        getQuery(event).channelId,
        "Channel ID is required",
      );
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(channelId);
      await ensureMember(
        pb,
        await pb.collection("dspeak_rooms").getOne(channel.room),
        userId,
      );
      const messages = await getBoundedList(
        pb,
        "dspeak_messages",
        {
          filter: `room_channel = '${channelId}'`,
          sort: "-created",
          expand: "sender,read_by",
        },
        200,
      );
      return messages.reverse().map((message) => ({
        id: message.id,
        content: message.content,
        room_channel: message.room_channel,
        sender: presentUser(message.expand?.sender, true),
        created: message.created,
        updated: message.updated,
        edited_at: message.edited_at || null,
        client_id: message.client_id || null,
        read_by: (message.expand?.read_by || []).map((user) =>
          presentUser(user),
        ),
      }));
    }

    const body = event.method === "GET" ? {} : await parseBody(event);

    if (suffix === "message" && event.method === "POST") {
      enforceRateLimit(event, "chat-message", userId, 120, 60 * 1000);
      requireValue(body.channelId, "Channel ID and content are required");
      requireValue(body.content, "Channel ID and content are required");
      if (typeof body.content !== "string" || body.content.length > 4000)
        throw createError({
          statusCode: 400,
          statusMessage: "Message content must be at most 4000 characters",
        });
      if (String(body.ownerId || "") !== String(userId))
        throw createError({
          statusCode: 409,
          statusMessage: "Queued message belongs to another account",
        });
      const clientId = String(body.clientMessageId || "");
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(clientId))
        throw createError({
          statusCode: 400,
          statusMessage: "A valid client message ID is required",
        });
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(body.channelId);
      const room = await pb.collection("dspeak_rooms").getOne(channel.room);
      await ensureMember(pb, room, userId);
      if (channel.isMedia)
        throw createError({
          statusCode: 400,
          statusMessage: "Cannot send text messages to a media channel",
        });
      let created;
      let wasCreated = false;
      try {
        created = await pb.collection("dspeak_messages").getFirstListItem(
          pb.filter("sender = {:sender} && client_id = {:client}", {
            sender: userId,
            client: clientId,
          }),
        );
      } catch (error) {
        if (error?.status !== 404 && error?.response?.status !== 404)
          throw error;
        try {
          created = await pb.collection("dspeak_messages").create({
            content: body.content,
            room_channel: channel.id,
            sender: userId,
            read_by: [userId],
            client_id: clientId,
          });
          wasCreated = true;
        } catch (createError) {
          if (createError?.status !== 400) throw createError;
          created = await pb.collection("dspeak_messages").getFirstListItem(
            pb.filter("sender = {:sender} && client_id = {:client}", {
              sender: userId,
              client: clientId,
            }),
          );
        }
      }
      const message = await pb
        .collection("dspeak_messages")
        .getOne(created.id, { expand: "sender" });
      const result = {
        id: message.id,
        content: message.content,
        room_channel: message.room_channel,
        sender: presentUser(message.expand?.sender, true),
        created: message.created,
        updated: message.updated,
        edited_at: message.edited_at || null,
        client_id: message.client_id || null,
        read_by: message.read_by || [],
      };
      if (wasCreated)
        broadcastToChannel(channel.id, { type: "new_message", data: result });
      const delivery = await persistMessageNotifications({
        pb,
        room,
        channel,
        message,
        senderId: userId,
      });
      if (delivery.notifications) {
        for (const recipient of (room.members || [])
          .map(String)
          .filter((id) => id !== String(userId))) {
          broadcastToUser(recipient, { type: "notifications_changed" });
        }
      }
      setResponseStatus(event, 201);
      return result;
    }

    if (
      ["message/edit", "message/delete", "message/history"].includes(suffix)
    ) {
      const messageId = requireValue(
        body.messageId || getQuery(event).messageId,
        "Message ID is required",
      );
      const message = await pb
        .collection("dspeak_messages")
        .getOne(messageId, { expand: "sender" });
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(message.room_channel);
      const room = await pb.collection("dspeak_rooms").getOne(channel.room);
      const access = await requireRoomMember(pb, room, userId);

      if (suffix === "message/history" && event.method === "GET") {
        if (!canViewMessageHistory(access.permissions, access.isOwner))
          throw createError({
            statusCode: 403,
            statusMessage:
              "Missing permission to view message revision history",
          });
        const revisions = await getBoundedList(
          pb,
          "dspeak_message_revisions",
          {
            filter: `message = '${message.id}'`,
            sort: "revision",
            expand: "editor",
          },
          100,
        );
        return revisions.map((revision) => ({
          id: revision.id,
          revision: revision.revision,
          content: revision.content,
          edited_at: revision.edited_at,
          editor: presentUser(revision.expand?.editor),
        }));
      }

      if (suffix === "message/edit" && event.method === "PATCH") {
        if (!isMessageOwner(message, userId))
          throw createError({
            statusCode: 403,
            statusMessage: "You can only edit your own messages",
          });
        const content = requireValue(
          body.content,
          "Message content is required",
        );
        if (typeof content !== "string" || content.length > 4000)
          throw createError({
            statusCode: 400,
            statusMessage: "Message content must be at most 4000 characters",
          });
        const nextContent = content.trim();
        requireValue(nextContent, "Message content is required");
        if (nextContent === message.content)
          throw createError({
            statusCode: 409,
            statusMessage: "The message content has not changed",
          });
        const existing = await getBoundedList(
          pb,
          "dspeak_message_revisions",
          {
            filter: `message = '${message.id}'`,
            sort: "-revision",
            perPage: 1,
          },
          1,
        );
        const nextRevision = existing.length
          ? Number(existing[0].revision) + 1
          : 2;
        const editedAt = new Date().toISOString();
        if (!existing.length)
          await pb.collection("dspeak_message_revisions").create({
            message: message.id,
            editor: message.sender,
            content: message.content,
            revision: 1,
            edited_at: message.created,
          });
        await pb.collection("dspeak_message_revisions").create({
          message: message.id,
          editor: userId,
          content: nextContent,
          revision: nextRevision,
          edited_at: editedAt,
        });
        const updated = await pb
          .collection("dspeak_messages")
          .update(message.id, {
            content: nextContent,
            edited_at: editedAt,
          });
        const result = {
          id: updated.id,
          content: updated.content,
          updated: updated.updated,
          edited_at: updated.edited_at,
        };
        broadcastToChannel(channel.id, {
          type: "message_updated",
          data: result,
        });
        return result;
      }

      if (suffix === "message/delete" && event.method === "DELETE") {
        if (
          !canDeleteMessage(message, userId, access.permissions, access.isOwner)
        )
          throw createError({
            statusCode: 403,
            statusMessage: "Missing permission to delete this message",
          });
        await pb.collection("dspeak_messages").delete(message.id);
        broadcastToChannel(channel.id, {
          type: "message_deleted",
          data: { id: message.id },
        });
        return { id: message.id, deleted: true };
      }
    }

    if (suffix === "read" && event.method === "POST") {
      const submittedIds = Array.isArray(body.messageIds)
        ? body.messageIds
        : body.messageId
          ? [body.messageId]
          : [];
      const ids = [
        ...new Set(
          submittedIds
            .filter((messageId) => typeof messageId === "string")
            .map((messageId) => messageId.trim())
            .filter(Boolean),
        ),
      ];
      requireValue(ids.length, "At least one message ID is required");
      if (ids.length > 200)
        throw createError({
          statusCode: 400,
          statusMessage: "A maximum of 200 message IDs is allowed",
        });
      const results = [];
      for (const messageId of ids) {
        try {
          const message = await pb
            .collection("dspeak_messages")
            .getOne(messageId);
          const channel = await pb
            .collection("dspeak_rooms_channels")
            .getOne(message.room_channel);
          await ensureMember(
            pb,
            await pb.collection("dspeak_rooms").getOne(channel.room),
            userId,
          );
          const readers = (message.read_by || []).map(String);
          if (!readers.includes(String(userId))) {
            const readBy = [...readers, userId];
            await pb
              .collection("dspeak_messages")
              .update(message.id, { read_by: readBy });
            broadcastToChannel(channel.id, {
              type: "message_updated",
              data: { id: message.id, read_by: readBy },
            });
            results.push({ messageId, status: "marked_as_read" });
          } else results.push({ messageId, status: "already_read" });
        } catch (error) {
          results.push({
            messageId,
            status: "error",
            error: pocketBaseError(error),
          });
        }
      }
      return { results };
    }

    if (suffix === "subscribe/global") {
      enforceRateLimit(event, "push-subscription", userId, 30, 60 * 60 * 1000);
      const deviceId = requireValue(
        getHeader(event, "x-dspeak-device"),
        "Device ID is required",
      );
      const existing = await getBoundedList(
        pb,
        "dspeak_push_subscriptions",
        {
          filter: pb.filter("user = {:user} && device_id = {:device}", {
            user: userId,
            device: deviceId,
          }),
        },
        10,
      );
      if (event.method === "GET")
        return {
          hasSubscription: existing.length > 0,
          subscription: existing[0]
            ? {
                id: existing[0].id,
                created: existing[0].created,
                updated: existing[0].updated,
              }
            : null,
        };
      if (event.method === "DELETE") {
        const endpoint = requireValue(
          body.subscription?.endpoint,
          "Subscription endpoint is required",
        );
        const matching = existing.filter(
          (subscription) => subscription.endpoint === endpoint,
        );
        for (const subscription of matching)
          await pb
            .collection("dspeak_push_subscriptions")
            .delete(subscription.id);
        return { success: true, message: "Device subscription deleted" };
      }
      if (event.method === "POST") {
        const subscription = requireValue(
          body.subscription,
          "Subscription is required",
        );
        const endpoint = requireValue(
          subscription.endpoint,
          "Subscription endpoint is required",
        );
        if (
          endpoint.length > 4096 ||
          String(subscription.keys?.p256dh || "").length > 512 ||
          String(subscription.keys?.auth || "").length > 512
        )
          throw createError({
            statusCode: 400,
            statusMessage: "Subscription data is too large",
          });
        const endpointUrl = new URL(endpoint);
        if (endpointUrl.protocol !== "https:")
          throw createError({
            statusCode: 400,
            statusMessage: "Subscription endpoint must use HTTPS",
          });
        const data = {
          user: userId,
          device_id: deviceId,
          endpoint,
          p256dh: requireValue(subscription.keys?.p256dh, "p256dh is required"),
          auth: requireValue(subscription.keys?.auth, "auth is required"),
          disabled: false,
          failure_count: 0,
        };
        const byEndpoint = await getBoundedList(
          pb,
          "dspeak_push_subscriptions",
          {
            filter: pb.filter("endpoint = {:endpoint}", { endpoint }),
          },
          2,
        );
        if (byEndpoint[0] && String(byEndpoint[0].user) !== String(userId))
          throw createError({
            statusCode: 409,
            statusMessage: "Subscription belongs to another account",
          });
        const record = byEndpoint[0] || existing[0];
        if (record)
          await pb
            .collection("dspeak_push_subscriptions")
            .update(record.id, data);
        else await pb.collection("dspeak_push_subscriptions").create(data);
        setResponseStatus(event, 201);
        return { success: true, message: "Device subscription updated" };
      }
    }

    if (suffix === "push/test" && event.method === "POST") {
      enforceRateLimit(event, "push-test", userId, 5, 60 * 60 * 1000);
      const deviceId = requireValue(
        getHeader(event, "x-dspeak-device"),
        "Device ID is required",
      );
      return sendPushTest(pb, userId, deviceId);
    }

    if (suffix === "subscribe" && event.method === "POST") {
      requireValue(body.roomId, "Room ID and subscription are required");
      requireValue(body.subscription, "Room ID and subscription are required");
      const existing = await getBoundedList(pb, "dspeak_webpush", {
        filter: pb.filter("room = {:room} && user = {:user}", {
          room: body.roomId,
          user: userId,
        }),
      });
      if (!existing.length)
        await pb.collection("dspeak_webpush").create({
          room: body.roomId,
          user: userId,
          keys: {
            endpoint: body.subscription.endpoint,
            p256dh: body.subscription.keys.p256dh,
            auth: body.subscription.keys.auth,
          },
        });
      setResponseStatus(event, 201);
      return { success: true };
    }

    throw createError({
      statusCode: 404,
      statusMessage: "Chat endpoint not found",
    });
  }

  return handleChat;
}
