import { db } from "../client.js";
import {
  roomSoundboards,
  librarySongs,
  streamPlayLog,
  avatars,
  roomImages,
} from "../schema/index.js";
import { eq, and, desc, asc } from "drizzle-orm";

export class AssetsRepository {
  async createSoundboard({ roomId, name, audioKey, volume, createdById }) {
    const result = await db
      .insert(roomSoundboards)
      .values({ roomId, name, audioKey, volume, createdById })
      .returning();
    return result[0];
  }

  async getSoundboards(roomId) {
    return db
      .select()
      .from(roomSoundboards)
      .where(eq(roomSoundboards.roomId, roomId))
      .orderBy(asc(roomSoundboards.createdAt));
  }

  async getSoundboard(soundboardId) {
    const result = await db
      .select()
      .from(roomSoundboards)
      .where(eq(roomSoundboards.id, soundboardId))
      .limit(1);
    return result[0] || null;
  }

  async updateSoundboard(soundboardId, { name, volume }) {
    const result = await db
      .update(roomSoundboards)
      .set({ name, volume })
      .where(eq(roomSoundboards.id, soundboardId))
      .returning();
    return result[0];
  }

  async deleteSoundboard(soundboardId) {
    await db
      .delete(roomSoundboards)
      .where(eq(roomSoundboards.id, soundboardId));
  }

  async addSong({
    roomId,
    title,
    artist,
    album,
    audioKey,
    artworkKey,
    duration,
    addedById,
  }) {
    const result = await db
      .insert(librarySongs)
      .values({
        roomId,
        title,
        artist,
        album,
        audioKey,
        artworkKey,
        duration,
        addedById,
      })
      .returning();
    return result[0];
  }

  async getSongs(roomId) {
    return db
      .select()
      .from(librarySongs)
      .where(eq(librarySongs.roomId, roomId))
      .orderBy(desc(librarySongs.createdAt));
  }

  async getSong(songId) {
    const result = await db
      .select()
      .from(librarySongs)
      .where(eq(librarySongs.id, songId))
      .limit(1);
    return result[0] || null;
  }

  async deleteSong(songId) {
    await db.delete(librarySongs).where(eq(librarySongs.id, songId));
  }

  async logPlay({ roomId, songId, playedById }) {
    const result = await db
      .insert(streamPlayLog)
      .values({ roomId, songId, playedById })
      .returning();
    return result[0];
  }

  async endPlay(playLogId) {
    await db
      .update(streamPlayLog)
      .set({ endedAt: new Date() })
      .where(eq(streamPlayLog.id, playLogId));
  }

  async getPlayLog(roomId, { limit = 50 } = {}) {
    return db
      .select()
      .from(streamPlayLog)
      .where(eq(streamPlayLog.roomId, roomId))
      .orderBy(desc(streamPlayLog.startedAt))
      .limit(limit);
  }

  async createAvatar({ userId, r2Key, mimeType, size }) {
    const result = await db
      .insert(avatars)
      .values({ userId, r2Key, mimeType, size })
      .returning();
    return result[0];
  }

  async getAvatar(userId) {
    const result = await db
      .select()
      .from(avatars)
      .where(eq(avatars.userId, userId))
      .orderBy(desc(avatars.createdAt))
      .limit(1);
    return result[0] || null;
  }

  async deleteAvatar(userId) {
    await db.delete(avatars).where(eq(avatars.userId, userId));
  }

  async createRoomImage({ roomId, type, r2Key, mimeType, size }) {
    const result = await db
      .insert(roomImages)
      .values({ roomId, type, r2Key, mimeType, size })
      .returning();
    return result[0];
  }

  async getRoomImages(roomId, type) {
    return db
      .select()
      .from(roomImages)
      .where(and(eq(roomImages.roomId, roomId), eq(roomImages.type, type)))
      .orderBy(desc(roomImages.createdAt));
  }

  async deleteRoomImage(imageId) {
    await db.delete(roomImages).where(eq(roomImages.id, imageId));
  }
}

export const assetsRepository = new AssetsRepository();
