export function createRoomsApiHandler(dependencies) {
  const {
    broadcastGlobally,
    broadcastParticipantChange,
    canManageMember,
    createError,
    decodeInvitePayload,
    deleteMatchingRecords,
    disconnectVoiceParticipant,
    encodeInvitePayload,
    ensureRoomMembership,
    getBoundedList,
    getQuery,
    normalizeAttenuation,
    normalizePermissions,
    normalizeRoomAccent,
    parseBody,
    presentPublicProfile,
    removeRoomMembership,
    requireAuthenticatedUser,
    requireRoleManagement,
    requireRoomMember,
    requireRoomPermission,
    requireValue,
    roomDetails,
    sameInstant,
    seedRoomRoles,
    sendWebResponse,
    setHeader,
    setResponseStatus,
    structuredValue,
    usePocketBaseAdmin,
    validateInviteExpiry,
    validateRoomImage,
  } = dependencies;

  async function handleRoomRoles(event, pb, userId) {
    const method = event.method;
    const body = method === "GET" ? {} : await parseBody(event);
    const roomId = requireValue(
      getQuery(event).roomId || body.roomId,
      "Room ID is required",
    );
    const room = await pb.collection("dspeak_rooms").getOne(roomId);
    await requireRoomMember(pb, room, userId);
    if (method === "GET") {
      const roles = await getBoundedList(pb, "dspeak_room_roles", {
        filter: `room = '${roomId}'`,
        sort: "-position",
      });
      const memberships = await getBoundedList(pb, "dspeak_room_memberships", {
        filter: `room = '${roomId}'`,
        expand: "user,roles",
      });
      return { roles, memberships };
    }
    if (method === "POST" && body.action === "assign") {
      await requireRoleManagement(pb, room, userId, null);
      const membership = await pb
        .collection("dspeak_room_memberships")
        .getOne(requireValue(body.membershipId, "Membership ID is required"), {
          expand: "roles",
        });
      if (String(membership.room) !== String(roomId))
        throw createError({
          statusCode: 400,
          statusMessage: "Membership must belong to this room",
        });
      for (const role of membership.expand?.roles || [])
        await requireRoleManagement(pb, room, userId, role);
      const roleIds = [
        ...new Set(
          (Array.isArray(body.roleIds) ? body.roleIds : []).map(String),
        ),
      ];
      if (!roleIds.length)
        throw createError({
          statusCode: 400,
          statusMessage: "A room member must have at least one role",
        });
      for (const roleId of roleIds) {
        const role = await pb.collection("dspeak_room_roles").getOne(roleId);
        if (String(role.room) !== String(roomId))
          throw createError({
            statusCode: 400,
            statusMessage: "Assigned roles must belong to this room",
          });
        await requireRoleManagement(pb, room, userId, role);
      }
      return pb
        .collection("dspeak_room_memberships")
        .update(membership.id, { roles: roleIds });
    }
    if (method === "POST") {
      const access = await requireRoleManagement(pb, room, userId, null);
      const position = Math.max(1, Math.floor(Number(body.position) || 1));
      if (!access.isOwner && position >= access.highestPosition)
        throw createError({
          statusCode: 403,
          statusMessage: "New roles must be below your highest role",
        });
      setResponseStatus(event, 201);
      return pb.collection("dspeak_room_roles").create({
        room: roomId,
        name: requireValue(body.name, "Role name is required"),
        color: normalizeRoomAccent(body.color),
        position,
        permissions: normalizePermissions(body.permissions),
        system: false,
        is_default: Boolean(body.isDefault),
      });
    }
    const role = await pb
      .collection("dspeak_room_roles")
      .getOne(requireValue(body.roleId, "Role ID is required"));
    const access = await requireRoleManagement(pb, room, userId, role);
    if (method === "PUT") {
      const position = Math.max(
        1,
        Math.floor(Number(body.position) || role.position),
      );
      if (!access.isOwner && position >= access.highestPosition)
        throw createError({
          statusCode: 403,
          statusMessage: "Roles must remain below your highest role",
        });
      return pb.collection("dspeak_room_roles").update(role.id, {
        name: body.name || role.name,
        color: normalizeRoomAccent(body.color || role.color),
        position,
        permissions:
          body.permissions === undefined
            ? role.permissions
            : normalizePermissions(body.permissions),
        is_default:
          body.isDefault === undefined
            ? role.is_default
            : Boolean(body.isDefault),
      });
    }
    if (method === "DELETE") {
      await pb.collection("dspeak_room_roles").delete(role.id);
      return { success: true };
    }
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" });
  }

  async function handleRooms(event, suffix) {
    const pb = await usePocketBaseAdmin();
    const method = event.method;
    const query = getQuery(event);

    if (suffix === "roles")
      return handleRoomRoles(event, pb, await requireAuthenticatedUser(event));

    if ((suffix === "profile" || suffix === "header") && method === "GET") {
      const id = requireValue(query.id, "Room ID is required");
      const room = await pb.collection("dspeak_rooms").getOne(id);
      const field = suffix === "header" ? "header_image" : "picture";
      if (!room[field])
        throw createError({
          statusCode: 404,
          statusMessage: "Image not found",
        });
      const response = await fetch(pb.files.getURL(room, room[field]));
      if (!response.ok)
        throw createError({
          statusCode: response.status,
          statusMessage: "Failed to fetch room image",
        });
      setHeader(event, "Cache-Control", "public, max-age=604800");
      setHeader(
        event,
        "Content-Type",
        response.headers.get("content-type") || "image/jpeg",
      );
      return sendWebResponse(event, response);
    }

    if (suffix === "details" && method === "GET") {
      const room = await pb
        .collection("dspeak_rooms")
        .getOne(requireValue(query.id, "Room ID is required"), {
          expand: "owner,members",
        });
      const userId = await requireAuthenticatedUser(event);
      await requireRoomMember(pb, room, userId);
      return roomDetails(pb, room, userId);
    }

    if (suffix === "invites" && method === "GET") {
      const payload = decodeInvitePayload(String(query.token || ""));
      if (!payload)
        throw createError({
          statusCode: 400,
          statusMessage: "Invalid invite link",
        });
      const invite = await pb
        .collection("dspeak_room_invites")
        .getOne(payload.id, { expand: "room,created_by" });
      if (
        String(invite.room) !== String(payload.roomId) ||
        String(invite.created_by) !== String(payload.createdBy) ||
        !sameInstant(invite.created_at, payload.createdAt) ||
        !sameInstant(invite.expires_at, payload.expiresAt)
      )
        throw createError({
          statusCode: 400,
          statusMessage: "Invalid invite link",
        });
      if (Date.parse(invite.expires_at) <= Date.now())
        throw createError({
          statusCode: 410,
          statusMessage: "This invite link has expired",
        });
      return {
        room: { id: invite.expand.room.id, name: invite.expand.room.name },
        invitedBy: presentPublicProfile(invite.expand.created_by),
        createdAt: invite.created_at,
        expiresAt: invite.expires_at,
      };
    }

    const userId = await requireAuthenticatedUser(event);

    if (!suffix && method === "GET") {
      const rooms = await getBoundedList(pb, "dspeak_rooms", {
        filter: `owner = '${userId}' || members ~ '${userId}'`,
        expand: "owner,members",
      });
      return Promise.all(rooms.map((room) => roomDetails(pb, room, userId)));
    }

    const body = method === "GET" ? {} : await parseBody(event);

    if (suffix === "invites" && method === "POST") {
      const room = await pb
        .collection("dspeak_rooms")
        .getOne(requireValue(body.roomId, "Room ID is required"));
      await requireRoomPermission(pb, room, userId, "room.manage_invites");
      const expirySeconds = validateInviteExpiry(body.expirySeconds);
      if (!expirySeconds)
        throw createError({
          statusCode: 400,
          statusMessage: "Invalid invite expiry",
        });
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(
        Date.now() + expirySeconds * 1000,
      ).toISOString();
      const invite = await pb.collection("dspeak_room_invites").create({
        room: room.id,
        created_by: userId,
        created_at: createdAt,
        expires_at: expiresAt,
      });
      const payload = {
        id: invite.id,
        createdBy: String(userId),
        createdAt,
        expiresAt,
        roomId: String(room.id),
      };
      await pb.collection("dspeak_room_audit_log").create({
        room: room.id,
        action: "invite.created",
        actor: userId,
        invite: invite.id,
        occurred_at: createdAt,
        details: { expiresAt },
      });
      setResponseStatus(event, 201);
      return { token: encodeInvitePayload(payload), ...payload };
    }

    if (suffix === "audit" && method === "GET") {
      const room = await pb
        .collection("dspeak_rooms")
        .getOne(requireValue(query.roomId, "Room ID is required"));
      const access = await requireRoomMember(pb, room, userId);
      if (
        !access.isOwner &&
        !access.permissions.some((permission) =>
          ["room.manage_invites", "room.manage_members"].includes(permission),
        )
      )
        throw createError({
          statusCode: 403,
          statusMessage: "Missing permission to view the audit log",
        });
      const records = await pb
        .collection("dspeak_room_audit_log")
        .getList(1, 100, {
          filter: `room = '${room.id}'`,
          sort: "-occurred_at",
          expand: "actor,subject",
        });
      return records.items.map((record) => ({
        id: record.id,
        action: record.action,
        occurredAt: record.occurred_at,
        details: record.details || {},
        actor: presentPublicProfile(record.expand?.actor),
        subject: presentPublicProfile(record.expand?.subject),
      }));
    }

    if (suffix === "kick" && method === "POST") {
      const room = await pb
        .collection("dspeak_rooms")
        .getOne(requireValue(body.roomId, "Room ID is required."));
      const targetUserId = String(
        requireValue(body.targetUserId, "Target user ID is required."),
      );
      if (targetUserId === String(userId))
        throw createError({
          statusCode: 400,
          statusMessage: "You cannot kick yourself.",
        });
      if (targetUserId === String(room.owner))
        throw createError({
          statusCode: 403,
          statusMessage: "The room owner cannot be kicked.",
        });
      const access = await requireRoomPermission(
        pb,
        room,
        userId,
        "room.manage_members",
      );
      let targetMembership;
      try {
        targetMembership = await pb
          .collection("dspeak_room_memberships")
          .getFirstListItem(`room = '${room.id}' && user = '${targetUserId}'`, {
            expand: "roles",
          });
      } catch (error) {
        if (error?.status !== 404) throw error;
      }
      const isLegacyMember = (room.members || [])
        .map(String)
        .includes(targetUserId);
      if (!targetMembership && !isLegacyMember)
        throw createError({
          statusCode: 404,
          statusMessage: "This user is not a room member.",
        });
      if (
        !canManageMember(
          access.roles,
          targetMembership?.expand?.roles || [],
          access.isOwner,
        )
      )
        throw createError({
          statusCode: 403,
          statusMessage: "You cannot kick a member at or above your role.",
        });
      await pb.collection("dspeak_rooms").update(room.id, {
        members: (room.members || [])
          .map(String)
          .filter((memberId) => memberId !== targetUserId),
      });
      const channels = await getBoundedList(pb, "dspeak_rooms_channels", {
        filter: `room = '${room.id}'`,
      });
      await Promise.all(
        channels
          .filter((channel) => channel.isMedia)
          .map((channel) =>
            disconnectVoiceParticipant(channel.id, targetUserId),
          ),
      );
      await Promise.all(
        channels
          .filter((channel) =>
            (channel.inRoom || []).map(String).includes(targetUserId),
          )
          .map((channel) =>
            pb.collection("dspeak_rooms_channels").update(channel.id, {
              inRoom: (channel.inRoom || [])
                .map(String)
                .filter((memberId) => memberId !== targetUserId),
            }),
          ),
      );
      await removeRoomMembership(pb, room.id, targetUserId);
      await broadcastParticipantChange(pb, room.id);
      return { message: "Member kicked successfully." };
    }

    if (!suffix && method === "POST") {
      requireValue(body.name, "Name is required for creating new room.");
      await validateRoomImage(body.picture, 2 * 1024 * 1024, "Room picture");
      await validateRoomImage(body.headerImage, 5 * 1024 * 1024, "Room header");
      const room = await pb.collection("dspeak_rooms").create({
        name: body.name,
        desc: body.desc || "",
        owner: userId,
        members: [userId],
        channels: [],
        accent: normalizeRoomAccent(body.accent),
        attenuation: normalizeAttenuation(structuredValue(body.attenuation)),
        ...(body.picture instanceof File && body.picture.size
          ? { picture: body.picture }
          : {}),
        ...(body.headerImage instanceof File && body.headerImage.size
          ? { header_image: body.headerImage }
          : {}),
      });
      await seedRoomRoles(pb, room, userId);
      const general = await pb.collection("dspeak_rooms_channels").create({
        name: "general",
        desc: "General chat channel",
        isMedia: false,
        audio_bitrate: null,
        inRoom: [],
        owner: userId,
        room: room.id,
      });
      const voice = await pb.collection("dspeak_rooms_channels").create({
        name: "voice",
        desc: "Voice and video channel",
        isMedia: true,
        audio_bitrate: 64,
        inRoom: [],
        owner: userId,
        room: room.id,
      });
      await pb
        .collection("dspeak_rooms")
        .update(room.id, { channels: [general.id, voice.id] });
      setResponseStatus(event, 201);
      return roomDetails(pb, room, userId);
    }

    if (!suffix && method === "PUT") {
      const room = await pb
        .collection("dspeak_rooms")
        .getOne(
          requireValue(body.roomId, "Room ID is required to edit a room."),
        );
      const identityUpdate =
        body.name || body.desc !== undefined || body.picture;
      if (identityUpdate)
        await requireRoomPermission(pb, room, userId, "room.update_identity");
      if (body.accent !== undefined || body.attenuation !== undefined)
        await requireRoomPermission(pb, room, userId, "room.update_theme");
      const update = {};
      await validateRoomImage(body.picture, 2 * 1024 * 1024, "Room picture");
      await validateRoomImage(body.headerImage, 5 * 1024 * 1024, "Room header");
      if (body.name) update.name = body.name;
      if (body.desc !== undefined) update.desc = body.desc;
      if (body.picture instanceof File && body.picture.size)
        update.picture = body.picture;
      if (body.headerImage instanceof File && body.headerImage.size)
        update.header_image = body.headerImage;
      if (body.accent !== undefined)
        update.accent = normalizeRoomAccent(body.accent);
      if (body.attenuation !== undefined)
        update.attenuation = normalizeAttenuation(
          structuredValue(body.attenuation),
        );
      const updated = await pb
        .collection("dspeak_rooms")
        .update(room.id, update);
      if (body.accent !== undefined || body.attenuation !== undefined) {
        const data = { id: updated.id };
        if (body.accent !== undefined)
          data.accent = normalizeRoomAccent(updated.accent);
        if (body.attenuation !== undefined)
          data.attenuation = normalizeAttenuation(updated.attenuation);
        broadcastGlobally({ type: "room_updated", data });
      }
      return roomDetails(pb, updated, userId);
    }

    if (!suffix && method === "DELETE") {
      const room = await pb
        .collection("dspeak_rooms")
        .getOne(
          requireValue(body.roomId, "Room ID is required to delete a room."),
        );
      if (String(room.owner) !== String(userId))
        throw createError({
          statusCode: 403,
          statusMessage: "Only the owner can delete this room.",
        });
      const channels = await getBoundedList(pb, "dspeak_rooms_channels", {
        filter: `room = '${room.id}'`,
      });
      for (const channel of channels) {
        await deleteMatchingRecords(
          pb,
          "dspeak_messages",
          `room_channel = '${channel.id}'`,
        );
        await pb.collection("dspeak_rooms_channels").delete(channel.id);
      }
      await pb.collection("dspeak_rooms").delete(room.id);
      return { message: "Room deleted successfully." };
    }

    if ((suffix === "join" || suffix === "leave") && method === "POST") {
      const room = await pb
        .collection("dspeak_rooms")
        .getOne(
          requireValue(body.roomId, `Room ID is required to ${suffix} a room.`),
        );
      const members = (room.members || []).map(String);
      if (suffix === "join") {
        let joinedInvite = null;
        const payload = decodeInvitePayload(String(body.inviteToken || ""));
        if (!members.includes(String(userId))) {
          if (!payload || String(payload.roomId) !== String(room.id))
            throw createError({
              statusCode: 403,
              statusMessage: "A valid invite link is required",
            });
          const invite = await pb
            .collection("dspeak_room_invites")
            .getOne(payload.id);
          if (
            String(invite.room) !== String(room.id) ||
            String(invite.created_by) !== String(payload.createdBy) ||
            !sameInstant(invite.created_at, payload.createdAt) ||
            !sameInstant(invite.expires_at, payload.expiresAt)
          )
            throw createError({
              statusCode: 403,
              statusMessage: "Invalid invite link",
            });
          if (Date.parse(invite.expires_at) <= Date.now())
            throw createError({
              statusCode: 410,
              statusMessage: "This invite link has expired",
            });
          joinedInvite = invite;
        }
        if (!members.includes(String(userId)))
          await pb
            .collection("dspeak_rooms")
            .update(room.id, { members: [...members, userId] });
        await ensureRoomMembership(pb, room, userId);
        if (joinedInvite)
          await pb.collection("dspeak_room_audit_log").create({
            room: room.id,
            action: "member.joined_via_invite",
            actor: joinedInvite.created_by,
            subject: userId,
            invite: joinedInvite.id,
            occurred_at: new Date().toISOString(),
            details: {
              inviteCreatedAt: joinedInvite.created_at,
              inviteExpiresAt: joinedInvite.expires_at,
            },
          });
      } else {
        if (String(room.owner) === String(userId) && members.length === 1) {
          throw createError({
            statusCode: 400,
            statusMessage:
              "Unable to leave this room, since you are the only member",
          });
        }
        await pb.collection("dspeak_rooms").update(room.id, {
          members: members.filter((id) => id !== String(userId)),
        });
        await removeRoomMembership(pb, room.id, userId);
      }
      await broadcastParticipantChange(pb, room.id);
      return {
        message: `Successfully ${suffix === "join" ? "joined" : "left"} the room.`,
      };
    }

    throw createError({
      statusCode: 404,
      statusMessage: "Room endpoint not found",
    });
  }

  return handleRooms;
}
