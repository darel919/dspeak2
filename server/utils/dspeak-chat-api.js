import {
  canSendInChannel,
  isSlowModeCooldownActive,
  normalizeChannelPolicy,
  normalizeSlowMode,
  slowModeRemainingMs,
} from "../../shared/channel-policy.js";
import { messageContainsBroadcastMention } from "../../shared/notification-policy.js";

export function createChatApiHandler(dependencies) {
  const {
    broadcastToChannel,
    broadcastToUser,
    assertSafeOutboundUrl,
    canDeleteMessage,
    canViewMessageHistory,
    createError,
    enforceRateLimit,
    ensureMember,
    fetchPublicHtml,
    getBoundedList,
    getHeader,
    getQuery,
    isMessageOwner,
    parseBody,
    persistMessageNotifications,
    presentUser,
    requireAuthenticatedUser,
    requireRoomMember,
    requireValue,
    sendPushTest,
    setResponseStatus,
    usePocketBaseAdmin,
    pushAllowedHosts,
  } = dependencies;

  async function validateReplyTarget(pb, replyTo, channelId) {
    if (!replyTo) return null;
    const target = await pb.collection("dspeak_messages").getOne(replyTo);
    if (String(target.room_channel) !== String(channelId))
      throw createError({
        statusCode: 400,
        statusMessage: "Reply target must be in the same channel",
      });
    return target.reply_to || target.id;
  }

  async function validateMessageAttachments(
    pb,
    submittedAttachments,
    channelId,
    userId,
    clientId,
  ) {
    if (submittedAttachments == null) return [];
    if (!Array.isArray(submittedAttachments) || submittedAttachments.length > 4)
      throw createError({
        statusCode: 400,
        statusMessage: "A message can include up to 4 images",
      });
    const attachments = [];
    const seen = new Set();
    for (const submitted of submittedAttachments) {
      const id = String(submitted?.id || "");
      if (!id || seen.has(id))
        throw createError({
          statusCode: 400,
          statusMessage: "Invalid image attachment",
        });
      seen.add(id);
      const record = await pb.collection("dspeak_chat_files").getOne(id);
      if (
        String(record.uploader) !== String(userId) ||
        String(record.room_channel) !== String(channelId)
      )
        throw createError({
          statusCode: 403,
          statusMessage: "Image attachment is not available in this channel",
        });
      if (record.message) {
        const attachedMessage = await pb
          .collection("dspeak_messages")
          .getOne(record.message);
        if (
          String(attachedMessage.sender) !== String(userId) ||
          String(attachedMessage.client_id) !== String(clientId)
        )
          throw createError({
            statusCode: 409,
            statusMessage: "Image is already attached to a message",
          });
      }
      attachments.push({
        id: record.id,
        url: `/api/assets/chat-file?id=${encodeURIComponent(record.id)}`,
        name: record.name,
        size: record.size,
        mime_type: record.mime_type,
        width: record.width || 0,
        height: record.height || 0,
      });
    }
    return attachments;
  }

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
      return {
        page: items.page,
        perPage: items.perPage,
        totalItems: items.totalItems,
        totalPages: items.totalPages,
        items: items.items.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          body: item.body,
          read_at: item.read_at || null,
          created: item.created,
          actor: presentUser(item.expand?.actor),
          room: item.expand?.room
            ? {
                id: item.expand.room.id,
                name: item.expand.room.name,
              }
            : null,
          channel: item.expand?.channel
            ? {
                id: item.expand.channel.id,
                name: item.expand.channel.name,
              }
            : null,
          message: item.expand?.message ? { id: item.expand.message.id } : null,
        })),
      };
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
      const memberships = await getBoundedList(pb, "dspeak_room_memberships", {
        filter: `user = '${userId}'`,
        fields: "room",
      });
      if (!memberships.length) return [];
      const rooms = await getBoundedList(pb, "dspeak_rooms", {
        filter: memberships
          .map((membership) => `id = '${membership.room}'`)
          .join(" || "),
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
        attachments: parseAttachments(message),
        reply_to: message.reply_to || null,
        pinned: Boolean(message.pinned),
      }));
    }

    const body = event.method === "GET" ? {} : await parseBody(event);

    if (suffix === "message" && event.method === "POST") {
      enforceRateLimit(event, "chat-message", userId, 120, 60 * 1000);
      requireValue(body.channelId, "Channel ID is required");
      const hasContent = typeof body.content === "string";
      const content = hasContent ? body.content.trim() : "";
      const hasAttachments =
        Array.isArray(body.attachments) && body.attachments.length > 0;
      if (!content && !hasAttachments)
        throw createError({
          statusCode: 400,
          statusMessage: "Message content or an image is required",
        });
      if (!hasContent || body.content.length > 4000)
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
      const access = await ensureMember(pb, room, userId);
      if (channel.isMedia)
        throw createError({
          statusCode: 400,
          statusMessage: "Cannot send text messages to a media channel",
        });
      const canSend = canSendInChannel({
        channelPolicy: normalizeChannelPolicy(channel.policy),
        isModeratorOrAbove:
          access.isOwner || access.permissions?.includes("message.moderate"),
        hasSendPermission: access.permissions?.includes("message.send"),
      });
      if (!canSend)
        throw createError({
          statusCode: 403,
          statusMessage: "You do not have permission to send in this channel",
        });
      if (
        (messageContainsBroadcastMention(content, "everyone") ||
          messageContainsBroadcastMention(content, "here")) &&
        !access.isOwner &&
        !access.permissions?.includes("message.moderate")
      )
        throw createError({
          statusCode: 403,
          statusMessage: "Missing permission to mention everyone or here",
        });
      const slowModeSeconds = normalizeSlowMode(channel.slow_mode);
      const slowModeApplies =
        slowModeSeconds > 0 &&
        !access.isOwner &&
        !access.permissions?.includes("message.moderate");
      if (slowModeApplies) {
        const recent = await getBoundedList(
          pb,
          "dspeak_messages",
          {
            filter: pb.filter(
              "room_channel = {:channel} && sender = {:sender}",
              { channel: channel.id, sender: userId },
            ),
            sort: "-created",
          },
          1,
        );
        const lastMessageAt = recent[0]
          ? new Date(recent[0].created).getTime()
          : 0;
        if (isSlowModeCooldownActive(lastMessageAt, slowModeSeconds))
          throw createError({
            statusCode: 429,
            statusMessage: `Slow mode is active. Try again in ${Math.ceil(
              slowModeRemainingMs(lastMessageAt, slowModeSeconds) / 1000,
            )} seconds`,
          });
      }
      const validatedAttachments = await validateMessageAttachments(
        pb,
        body.attachments,
        channel.id,
        userId,
        clientId,
      );
      const replyTo = await validateReplyTarget(pb, body.replyTo, channel.id);
      if (slowModeApplies)
        enforceRateLimit(
          event,
          "chat-slow-mode",
          `${userId}:${channel.id}`,
          1,
          slowModeSeconds * 1000,
        );
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
            content,
            room_channel: channel.id,
            sender: userId,
            read_by: [userId],
            client_id: clientId,
            reply_to: replyTo,
            attachments: validatedAttachments,
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
      for (const attachment of validatedAttachments)
        await pb
          .collection("dspeak_chat_files")
          .update(attachment.id, { message: created.id });
      const message = await pb
        .collection("dspeak_messages")
        .getOne(created.id, { expand: "sender" });
      const attachments = parseAttachments(message);
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
        reply_to: message.reply_to || null,
        attachments,
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
        for (const recipient of delivery.recipients) {
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
            error: { code: "READ_UPDATE_FAILED" },
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
        try {
          await assertSafeOutboundUrl(endpoint, {
            allowedHosts: pushAllowedHosts,
          });
        } catch {
          throw createError({
            statusCode: 400,
            statusMessage: "Subscription endpoint is not permitted",
          });
        }
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

    if (suffix === "upload" && event.method === "POST") {
      enforceRateLimit(event, "chat-upload", userId, 30, 60 * 1000);
      const form = body;
      const channelId = requireValue(form.channelId, "Channel ID is required");
      const file = form.file;
      if (!file || !(file instanceof File))
        throw createError({
          statusCode: 400,
          statusMessage: "File is required",
        });
      if (file.size > 10 * 1024 * 1024)
        throw createError({
          statusCode: 413,
          statusMessage: "File exceeds 10MB limit",
        });
      const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowed.includes(file.type))
        throw createError({
          statusCode: 415,
          statusMessage: "File must be JPEG, PNG, WebP, or GIF",
        });
      const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const png = bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
      const webp =
        String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
      const gif = ["GIF87a", "GIF89a"].includes(
        String.fromCharCode(...bytes.slice(0, 6)),
      );
      if (!jpeg && !png && !webp && !gif)
        throw createError({
          statusCode: 415,
          statusMessage: "Image file contents are invalid",
        });
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(channelId);
      await ensureMember(
        pb,
        await pb.collection("dspeak_rooms").getOne(channel.room),
        userId,
      );
      const record = await pb.collection("dspeak_chat_files").create({
        uploader: userId,
        room_channel: channelId,
        file: file,
        name: file.name,
        size: file.size,
        mime_type: file.type,
        width: Math.max(0, Math.min(20000, Number(form.width) || 0)),
        height: Math.max(0, Math.min(20000, Number(form.height) || 0)),
      });
      return {
        id: record.id,
        url: `/api/assets/chat-file?id=${record.id}`,
        name: record.name,
        size: record.size,
        mime_type: record.mime_type,
        width: record.width || 0,
        height: record.height || 0,
      };
    }

    if (suffix === "upload" && event.method === "DELETE") {
      enforceRateLimit(event, "chat-upload-delete", userId, 60, 60 * 1000);
      const fileId = requireValue(body.fileId, "File ID is required");
      const record = await pb.collection("dspeak_chat_files").getOne(fileId);
      if (String(record.uploader) !== String(userId))
        throw createError({
          statusCode: 403,
          statusMessage: "You can only remove your own upload",
        });
      if (record.message)
        throw createError({
          statusCode: 409,
          statusMessage: "Image is already attached to a message",
        });
      await pb.collection("dspeak_chat_files").delete(record.id);
      return { deleted: true, id: record.id };
    }

    if (suffix === "reaction" && event.method === "POST") {
      enforceRateLimit(event, "chat-reaction", userId, 120, 60 * 1000);
      const messageId = requireValue(body.messageId, "Message ID is required");
      const emoji = String(requireValue(body.emoji, "Emoji is required"));
      if (
        emoji.length > 32 ||
        !/^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f\u20e3\u{1f1e6}-\u{1f1ff}0-9#*]+$/u.test(
          emoji,
        )
      )
        throw createError({ statusCode: 400, statusMessage: "Invalid emoji" });
      const message = await pb.collection("dspeak_messages").getOne(messageId);
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(message.room_channel);
      await ensureMember(
        pb,
        await pb.collection("dspeak_rooms").getOne(channel.room),
        userId,
      );
      let existing;
      try {
        existing = await pb
          .collection("dspeak_message_reactions")
          .getFirstListItem(
            pb.filter(
              "message = {:message} && user = {:user} && emoji = {:emoji}",
              { message: messageId, user: userId, emoji },
            ),
          );
      } catch (error) {
        if (error?.status !== 404 && error?.response?.status !== 404)
          throw error;
      }
      if (existing) {
        await pb.collection("dspeak_message_reactions").delete(existing.id);
        broadcastToChannel(channel.id, {
          type: "message_reaction_removed",
          data: { messageId, emoji, userId },
        });
      } else {
        await pb.collection("dspeak_message_reactions").create({
          message: messageId,
          user: userId,
          emoji,
          skin_tone: body.skinTone || "",
        });
        broadcastToChannel(channel.id, {
          type: "message_reaction_added",
          data: { messageId, emoji, userId },
        });
      }

      const allReactions = await getBoundedList(
        pb,
        "dspeak_message_reactions",
        {
          filter: pb.filter("message = {:message}", { message: messageId }),
          expand: "user",
        },
      );
      const grouped = {};
      for (const reaction of allReactions) {
        if (!grouped[reaction.emoji])
          grouped[reaction.emoji] = {
            emoji: reaction.emoji,
            count: 0,
            users: [],
          };
        grouped[reaction.emoji].count += 1;
        grouped[reaction.emoji].users.push(presentUser(reaction.expand?.user));
      }
      return { reactions: Object.values(grouped) };
    }

    if (suffix === "reactions" && event.method === "GET") {
      const query = getQuery(event);
      const channelId = requireValue(query.channelId, "Channel ID is required");
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(channelId);
      await ensureMember(
        pb,
        await pb.collection("dspeak_rooms").getOne(channel.room),
        userId,
      );
      const messageIds = [
        ...new Set(
          String(query.messageIds || query.messageId || "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];
      if (!messageIds.length || messageIds.length > 200)
        throw createError({
          statusCode: 400,
          statusMessage: "Between 1 and 200 message IDs are required",
        });
      if (messageIds.some((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id)))
        throw createError({
          statusCode: 400,
          statusMessage: "Invalid message ID",
        });
      const requestedMessages = await getBoundedList(
        pb,
        "dspeak_messages",
        {
          filter: messageIds.map((id) => `id = '${id}'`).join(" || "),
          fields: "id,room_channel",
        },
        200,
      );
      if (
        requestedMessages.length !== messageIds.length ||
        requestedMessages.some(
          (message) => String(message.room_channel) !== String(channelId),
        )
      )
        throw createError({
          statusCode: 404,
          statusMessage: "Message was not found in this channel",
        });
      const allReactions = await getBoundedList(
        pb,
        "dspeak_message_reactions",
        {
          filter: messageIds.map((id) => `message = '${id}'`).join(" || "),
          expand: "user",
        },
        1000,
      );
      const reactionsByMessage = Object.fromEntries(
        messageIds.map((id) => [id, []]),
      );
      const grouped = new Map();
      for (const reaction of allReactions) {
        const key = `${reaction.message}:${reaction.emoji}`;
        if (!grouped.has(key))
          grouped.set(key, {
            messageId: reaction.message,
            emoji: reaction.emoji,
            count: 0,
            users: [],
          });
        const group = grouped.get(key);
        group.count += 1;
        group.users.push(presentUser(reaction.expand?.user));
      }
      for (const group of grouped.values()) {
        reactionsByMessage[group.messageId].push({
          emoji: group.emoji,
          count: group.count,
          users: group.users,
        });
      }
      return {
        reactionsByMessage,
        reactions:
          messageIds.length === 1
            ? reactionsByMessage[messageIds[0]]
            : undefined,
      };
    }

    if (suffix === "pinned" && event.method === "GET") {
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
      const pinned = await getBoundedList(pb, "dspeak_pinned_messages", {
        filter: `channel = '${channelId}'`,
        sort: "-pinned_at",
        expand: "message,message.sender,pinned_by",
      });
      return {
        pinned: pinned.map((pin) => ({
          id: pin.id,
          message: pin.message,
          pinned_by: presentUser(pin.expand?.pinned_by),
          pinned_at: pin.pinned_at,
          expand: {
            message: pin.expand?.message
              ? {
                  id: pin.expand.message.id,
                  content: pin.expand.message.content,
                  created: pin.expand.message.created,
                  sender: presentUser(pin.expand.message.expand?.sender),
                }
              : null,
            pinned_by: presentUser(pin.expand?.pinned_by),
          },
        })),
      };
    }

    if (suffix === "pin" && event.method === "POST") {
      enforceRateLimit(event, "chat-pin", userId, 60, 60 * 1000);
      const messageId = requireValue(body.messageId, "Message ID is required");
      const channelId = requireValue(body.channelId, "Channel ID is required");
      const message = await pb.collection("dspeak_messages").getOne(messageId);
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(channelId);
      if (String(message.room_channel) !== String(channel.id))
        throw createError({
          statusCode: 400,
          statusMessage: "Message does not belong to this channel",
        });
      const room = await pb.collection("dspeak_rooms").getOne(channel.room);
      const access = await requireRoomMember(pb, room, userId);
      if (!access.isOwner && !access.permissions?.includes("message.moderate"))
        throw createError({
          statusCode: 403,
          statusMessage: "Missing permission to pin messages",
        });
      const existing = await getBoundedList(pb, "dspeak_pinned_messages", {
        filter: `message = '${messageId}'`,
      });
      if (existing.length > 0)
        throw createError({
          statusCode: 409,
          statusMessage: "Message is already pinned",
        });
      const pinBatch = pb.createBatch();
      pinBatch.collection("dspeak_pinned_messages").create({
        message: messageId,
        channel: channelId,
        pinned_by: userId,
        pinned_at: new Date().toISOString(),
      });
      pinBatch
        .collection("dspeak_messages")
        .update(messageId, { pinned: true });
      await pinBatch.send();
      const pinned = await pb
        .collection("dspeak_pinned_messages")
        .getFirstListItem(
          pb.filter("message = {:message}", { message: messageId }),
        );
      broadcastToChannel(channel.id, {
        type: "message_pinned",
        data: { id: pinned.id, messageId, channelId, pinnedBy: userId },
      });
      return { id: pinned.id, messageId, pinned: true };
    }

    if (suffix === "unpin" && event.method === "POST") {
      enforceRateLimit(event, "chat-unpin", userId, 60, 60 * 1000);
      const messageId = requireValue(body.messageId, "Message ID is required");
      const message = await pb.collection("dspeak_messages").getOne(messageId);
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(message.room_channel);
      const room = await pb.collection("dspeak_rooms").getOne(channel.room);
      const access = await requireRoomMember(pb, room, userId);
      if (!access.isOwner && !access.permissions?.includes("message.moderate"))
        throw createError({
          statusCode: 403,
          statusMessage: "Missing permission to unpin messages",
        });
      const existing = await getBoundedList(pb, "dspeak_pinned_messages", {
        filter: `message = '${messageId}'`,
      });
      const unpinBatch = pb.createBatch();
      for (const pin of existing)
        unpinBatch.collection("dspeak_pinned_messages").delete(pin.id);
      unpinBatch
        .collection("dspeak_messages")
        .update(messageId, { pinned: false });
      await unpinBatch.send();
      broadcastToChannel(channel.id, {
        type: "message_unpinned",
        data: { messageId, channelId: channel.id },
      });
      return { success: true };
    }

    if (suffix === "bookmarks" && event.method === "GET") {
      const bookmarks = await getBoundedList(pb, "dspeak_bookmarks", {
        filter: pb.filter("user = {:user}", { user: userId }),
        sort: "-saved_at",
        expand: "message,message.sender",
      });
      const accessibleBookmarks = [];
      const channelCache = new Map();
      const roomAccessCache = new Map();
      for (const bookmark of bookmarks) {
        const message = bookmark.expand?.message;
        if (!message?.room_channel) continue;
        try {
          if (!channelCache.has(message.room_channel))
            channelCache.set(
              message.room_channel,
              pb
                .collection("dspeak_rooms_channels")
                .getOne(message.room_channel),
            );
          const channel = await channelCache.get(message.room_channel);
          if (!roomAccessCache.has(channel.room))
            roomAccessCache.set(
              channel.room,
              pb
                .collection("dspeak_rooms")
                .getOne(channel.room)
                .then((room) => ensureMember(pb, room, userId)),
            );
          await roomAccessCache.get(channel.room);
          accessibleBookmarks.push(bookmark);
        } catch (error) {
          const status =
            error?.statusCode || error?.status || error?.response?.status;
          if (status !== 403 && status !== 404) throw error;
        }
      }
      return {
        bookmarks: accessibleBookmarks.map((bm) => ({
          id: bm.id,
          message: bm.message,
          note: bm.note || "",
          saved_at: bm.saved_at,
          expand: {
            message: bm.expand?.message
              ? {
                  id: bm.expand.message.id,
                  content: bm.expand.message.content,
                  created: bm.expand.message.created,
                  room_channel: bm.expand.message.room_channel,
                  sender: presentUser(bm.expand.message.expand?.sender),
                }
              : null,
          },
        })),
      };
    }

    if (suffix === "bookmark" && event.method === "POST") {
      enforceRateLimit(event, "chat-bookmark", userId, 60, 60 * 1000);
      const messageId = requireValue(body.messageId, "Message ID is required");
      const message = await pb.collection("dspeak_messages").getOne(messageId);
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(message.room_channel);
      await ensureMember(
        pb,
        await pb.collection("dspeak_rooms").getOne(channel.room),
        userId,
      );
      const existing = await getBoundedList(pb, "dspeak_bookmarks", {
        filter: `user = '${userId}' && message = '${messageId}'`,
      });
      if (existing.length > 0)
        throw createError({
          statusCode: 409,
          statusMessage: "Message is already bookmarked",
        });
      const bookmark = await pb.collection("dspeak_bookmarks").create({
        user: userId,
        message: messageId,
        note: body.note || "",
        saved_at: new Date().toISOString(),
      });
      return { id: bookmark.id, messageId, saved_at: bookmark.saved_at };
    }

    if (suffix === "bookmark" && event.method === "DELETE") {
      enforceRateLimit(event, "chat-bookmark", userId, 60, 60 * 1000);
      const messageId = requireValue(body.messageId, "Message ID is required");
      const existing = await getBoundedList(pb, "dspeak_bookmarks", {
        filter: `user = '${userId}' && message = '${messageId}'`,
      });
      for (const bm of existing)
        await pb.collection("dspeak_bookmarks").delete(bm.id);
      return { success: true };
    }

    if (suffix === "search" && event.method === "GET") {
      enforceRateLimit(event, "chat-search", userId, 30, 60 * 1000);
      const query = getQuery(event);
      const channelId = requireValue(query.channelId, "Channel ID is required");
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(channelId);
      await ensureMember(
        pb,
        await pb.collection("dspeak_rooms").getOne(channel.room),
        userId,
      );
      const searchQ = String(query.q || "").trim();
      if (searchQ.length > 200)
        throw createError({
          statusCode: 400,
          statusMessage: "Search query must be 200 characters or fewer",
        });
      if (query.has && !["attachment", "link"].includes(String(query.has)))
        throw createError({
          statusCode: 400,
          statusMessage: "Invalid content filter",
        });
      const hasFilters = Boolean(
        query.author || query.has || query.before || query.after,
      );
      if (!searchQ && !hasFilters) return { messages: [], total: 0 };
      const conditions = ["room_channel = {:channelId}"];
      const parameters = { channelId };
      if (searchQ) {
        conditions.push("content ~ {:searchQ}");
        parameters.searchQ = searchQ;
      }
      if (query.author) {
        const author = String(query.author);
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(author))
          throw createError({
            statusCode: 400,
            statusMessage: "Invalid author filter",
          });
        conditions.push("sender = {:author}");
        parameters.author = author;
      }
      if (query.has === "attachment") conditions.push("attachments != null");
      if (query.has === "link") conditions.push("content ~ 'https?://'");
      for (const [name, operator] of [
        ["before", "<"],
        ["after", ">"],
      ]) {
        if (!query[name]) continue;
        const timestamp = Date.parse(String(query[name]));
        if (!Number.isFinite(timestamp))
          throw createError({
            statusCode: 400,
            statusMessage: `Invalid ${name} date`,
          });
        conditions.push(`created ${operator} {:${name}}`);
        parameters[name] = new Date(timestamp).toISOString();
      }
      const filter = pb.filter(conditions.join(" && "), parameters);
      const results = await getBoundedList(
        pb,
        "dspeak_messages",
        {
          filter,
          sort: "-created",
          expand: "sender",
        },
        50,
      );
      return {
        messages: results.map((msg) => ({
          id: msg.id,
          content: msg.content,
          room_channel: msg.room_channel,
          sender: presentUser(msg.expand?.sender, true),
          created: msg.created,
          updated: msg.updated,
          edited_at: msg.edited_at || null,
          attachments: parseAttachments(msg),
          reply_to: msg.reply_to || null,
          pinned: Boolean(msg.pinned),
        })),
        total: results.length,
      };
    }

    if (suffix === "link-preview" && event.method === "GET") {
      enforceRateLimit(event, "link-preview", userId, 60, 60 * 1000);
      const url = requireValue(getQuery(event).url, "URL is required");
      try {
        await assertSafeOutboundUrl(url, { allowedHosts: pushAllowedHosts });
      } catch {
        throw createError({
          statusCode: 400,
          statusMessage: "URL is not permitted",
        });
      }
      try {
        const previewPage = await fetchPublicHtml(url, {
          allowedHosts: pushAllowedHosts,
          maxBytes: 512 * 1024,
          maxRedirects: 3,
          timeoutMs: 5000,
        });
        const html = previewPage.html;
        const title =
          extractMeta(html, "og:title") ||
          extractMeta(html, "twitter:title") ||
          extractTitle(html);
        const description =
          extractMeta(html, "og:description") ||
          extractMeta(html, "twitter:description") ||
          "";
        const image =
          extractMeta(html, "og:image") ||
          extractMeta(html, "twitter:image") ||
          "";
        const siteName = extractMeta(html, "og:site_name") || "";
        const favicon = extractFavicon(html, previewPage.url);
        return {
          url: previewPage.url,
          title,
          description,
          image,
          siteName,
          favicon,
        };
      } catch {
        return {
          url,
          title: "",
          description: "",
          image: "",
          siteName: "",
          favicon: "",
        };
      }
    }

    if (suffix === "thread" && event.method === "GET") {
      const messageId = requireValue(
        getQuery(event).messageId,
        "Message ID is required",
      );
      const parent = await pb
        .collection("dspeak_messages")
        .getOne(messageId, { expand: "sender" });
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(parent.room_channel);
      await ensureMember(
        pb,
        await pb.collection("dspeak_rooms").getOne(channel.room),
        userId,
      );
      const replies = await getBoundedList(pb, "dspeak_messages", {
        filter: `reply_to = '${messageId}'`,
        sort: "created",
        expand: "sender",
      });
      return {
        parent: {
          id: parent.id,
          content: parent.content,
          room_channel: parent.room_channel,
          sender: presentUser(parent.expand?.sender, true),
          created: parent.created,
          updated: parent.updated,
          edited_at: parent.edited_at || null,
          attachments: parseAttachments(parent),
          reply_to: parent.reply_to || null,
          pinned: Boolean(parent.pinned),
        },
        replies: replies.map((reply) => ({
          id: reply.id,
          content: reply.content,
          room_channel: reply.room_channel,
          sender: presentUser(reply.expand?.sender, true),
          created: reply.created,
          updated: reply.updated,
          edited_at: reply.edited_at || null,
          attachments: parseAttachments(reply),
          reply_to: reply.reply_to || null,
          pinned: Boolean(reply.pinned),
        })),
      };
    }

    if (suffix === "message/undo" && event.method === "POST") {
      const messageId = requireValue(body.messageId, "Message ID is required");
      const message = await pb
        .collection("dspeak_messages")
        .getOne(messageId, { expand: "sender" });
      if (String(message.sender) !== String(userId))
        throw createError({
          statusCode: 403,
          statusMessage: "You can only undo your own messages",
        });
      const created = new Date(message.created).getTime();
      if (Date.now() - created > 3000)
        throw createError({
          statusCode: 400,
          statusMessage: "Undo window has expired (3 seconds)",
        });
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(message.room_channel);
      await pb.collection("dspeak_messages").delete(message.id);
      broadcastToChannel(channel.id, {
        type: "message_deleted",
        data: { id: message.id },
      });
      return { id: message.id, deleted: true };
    }

    throw createError({
      statusCode: 404,
      statusMessage: "Chat endpoint not found",
    });
  }

  return handleChat;
}

function extractMeta(html, property) {
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapeRegex(property)}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const match = html.match(regex);
  if (match) return decodeHtmlEntities(match[1]);
  const altRegex = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escapeRegex(property)}["']`,
    "i",
  );
  const altMatch = html.match(altRegex);
  return altMatch ? decodeHtmlEntities(altMatch[1]) : "";
}

function extractTitle(html) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function extractFavicon(html, baseUrl) {
  const match = html.match(
    /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']*)["']/i,
  );
  if (!match) {
    try {
      return new URL("/favicon.ico", baseUrl).href;
    } catch {
      return "";
    }
  }
  try {
    return new URL(match[1], baseUrl).href;
  } catch {
    return match[1];
  }
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function parseAttachments(message) {
  if (!message) return [];

  if (
    message.attachments &&
    typeof message.attachments === "object" &&
    Array.isArray(message.attachments)
  ) {
    return message.attachments;
  }
  if (message.attachments && typeof message.attachments === "string") {
    try {
      const parsed = JSON.parse(message.attachments);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
