import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  profiles,
  roomMemberships,
  userNicknames,
} from "../db/schema/index.ts";
import {
  normalizeDisplayName,
  normalizeHandle,
  normalizeNickname,
} from "../../shared/user-profile.ts";
import { getRoomById } from "./room-authorization.ts";
import type { H3Event } from "h3";
import type { ProfileUpdateInput } from "../types/profile-repository.ts";
import type { ProfileApiDependencies } from "../types/profile-api.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createProfileApiHandler(dependencies: ProfileApiDependencies) {
  const {
    broadcastGlobally,
    createError,
    enforceRateLimit,
    getRoomById: getRoomByIdOverride = getRoomById,
    parseBody,
    presentPublicProfile,
    presentUser,
    requireAuthenticatedUser,
    requireRoomMember,
    requireValue,
    updateActiveUserProfile,
    updateProfileAvatar,
  } = dependencies;

  async function validateRoomImage(
    file: File,
    limit: number,
    label: string,
    allowGif = false,
  ): Promise<void> {
    if (!(file instanceof File) || !file.size) return;
    if (file.size > limit)
      throw createError({
        statusCode: 413,
        statusMessage: `${label} exceeds the upload limit`,
      });
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      ...(allowGif ? ["image/gif"] : []),
    ];
    if (!allowed.includes(file.type))
      throw createError({
        statusCode: 415,
        statusMessage: `${label} must be JPEG, PNG, WebP${allowGif ? ", or GIF" : ""}`,
      });
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const png = bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
    const webp =
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    const gif = String.fromCharCode(...bytes.slice(0, 4)) === "GIF8";
    const validSignature = {
      "image/jpeg": jpeg,
      "image/png": png,
      "image/webp": webp,
      "image/gif": gif,
    }[file.type];
    if (!validSignature)
      throw createError({
        statusCode: 415,
        statusMessage: `${label} is invalid`,
      });
  }

  async function handleProfile(event: H3Event, suffix: string) {
    const userId = await requireAuthenticatedUser(event);
    if (!["GET", "HEAD"].includes(event.method))
      enforceRateLimit(event, "profile-mutation", userId, 30, 60 * 60 * 1000);

    if (!suffix && event.method === "GET") {
      const profile = await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      return presentUser(profile[0]);
    }

    if (!suffix && event.method === "PATCH") {
      const body = await parseBody(event);
      const update: ProfileUpdateInput = {};
      if (Object.hasOwn(body, "displayName")) {
        try {
          update.displayName = normalizeDisplayName(body.displayName);
        } catch (error: unknown) {
          throw createError({
            statusCode: 400,
            statusMessage: errorMessage(error),
          });
        }
      }
      if (Object.hasOwn(body, "handle")) {
        try {
          update.username = normalizeHandle(body.handle);
        } catch (error: unknown) {
          throw createError({
            statusCode: 400,
            statusMessage: errorMessage(error),
          });
        }
      }
      if (body.avatar instanceof File && body.avatar.size)
        await validateRoomImage(
          body.avatar,
          5 * 1024 * 1024,
          "Profile picture",
          true,
        );
      if (
        !Object.keys(update).length &&
        !(body.avatar instanceof File && body.avatar.size) &&
        body.removeAvatar !== true &&
        body.removeAvatar !== "true"
      )
        throw createError({
          statusCode: 400,
          statusMessage: "No profile changes provided",
        });
      let updated;
      try {
        updated = await updateProfileAvatar({ db, userId, body, update });
      } catch (error: unknown) {
        if (errorMessage(error).includes("unique"))
          throw createError({
            statusCode: 409,
            statusMessage: "Username is already taken",
          });
        throw error;
      }
      if (!updated)
        throw createError({
          statusCode: 500,
          statusMessage: "Profile update did not persist",
        });
      const publicProfile = presentPublicProfile(updated);
      await updateActiveUserProfile(publicProfile);
      broadcastGlobally({ type: "profile_updated", data: publicProfile });
      return presentUser(updated);
    }

    if (suffix === "nicknames" && event.method === "GET") {
      const rows = await db
        .select()
        .from(userNicknames)
        .where(eq(userNicknames.setById, userId));
      return {
        nicknames: Object.fromEntries(
          rows.map((row) => [String(row.userId), row.nickname]),
        ),
      };
    }

    if (suffix === "nickname" && event.method === "PUT") {
      const body = await parseBody(event);
      const targetUserId = requireValue(
        String(body.targetUserId || "").trim(),
        "Target user is required",
      );
      const roomId = requireValue(
        String(body.roomId || "").trim(),
        "Room ID is required",
      );
      const room = await getRoomByIdOverride(roomId);
      if (!room)
        throw createError({ statusCode: 404, statusMessage: "Room not found" });
      await requireRoomMember(room, userId);
      const target = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, targetUserId))
        .limit(1);
      if (!target[0])
        throw createError({ statusCode: 404, statusMessage: "User not found" });
      const targetMembership = await db
        .select({ id: roomMemberships.id })
        .from(roomMemberships)
        .where(
          and(
            eq(roomMemberships.roomId, roomId),
            eq(roomMemberships.userId, targetUserId),
          ),
        )
        .limit(1);
      if (!targetMembership[0])
        throw createError({
          statusCode: 404,
          statusMessage: "User is not a member of this room",
        });
      let nickname;
      try {
        nickname = normalizeNickname(body.nickname);
      } catch (error: unknown) {
        throw createError({
          statusCode: 400,
          statusMessage: errorMessage(error),
        });
      }
      const existing = await db
        .select({ id: userNicknames.id })
        .from(userNicknames)
        .where(
          and(
            eq(userNicknames.roomId, roomId),
            eq(userNicknames.userId, targetUserId),
          ),
        )
        .limit(1);
      if (!nickname) {
        if (existing[0])
          await db
            .delete(userNicknames)
            .where(eq(userNicknames.id, existing[0].id));
        return { targetUserId, nickname: "" };
      }
      const result = existing[0]
        ? await db
            .update(userNicknames)
            .set({ nickname, setById: userId })
            .where(eq(userNicknames.id, existing[0].id))
            .returning()
        : await db
            .insert(userNicknames)
            .values({ roomId, userId: targetUserId, nickname, setById: userId })
            .returning();
      const updatedNickname = result[0];
      if (!updatedNickname)
        throw createError({
          statusCode: 500,
          statusMessage: "Nickname update did not persist",
        });
      return { targetUserId, nickname: updatedNickname.nickname };
    }

    throw createError({
      statusCode: 404,
      statusMessage: "Profile endpoint not found",
    });
  }

  return handleProfile;
}
