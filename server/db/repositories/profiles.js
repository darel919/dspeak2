import { db } from "../client.js";
import { profiles } from "../schema/index.js";
import { eq } from "drizzle-orm";

export class ProfileRepository {
  async findById(id) {
    const result = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, id))
      .limit(1);
    return result[0] || null;
  }

  async findByUsername(username) {
    const result = await db
      .select()
      .from(profiles)
      .where(eq(profiles.username, username))
      .limit(1);
    return result[0] || null;
  }

  async create(id, { username, displayName, avatarKey }) {
    const result = await db
      .insert(profiles)
      .values({
        id,
        username,
        displayName,
        avatarKey,
      })
      .returning();
    return result[0];
  }

  async update(id, { username, displayName, avatarKey }) {
    const result = await db
      .update(profiles)
      .set({
        username,
        displayName,
        avatarKey,
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, id))
      .returning();
    return result[0];
  }

  async getOrCreateOnFirstLogin(
    userId,
    { email, username: preferredUsername, displayName, avatarKey },
  ) {
    let profile = await this.findById(userId);
    if (profile) return profile;

    let username = preferredUsername || email.split("@")[0];
    let counter = 1;
    while (await this.findByUsername(username)) {
      username = `${preferredUsername || email.split("@")[0]}${counter}`;
      counter++;
    }

    profile = await this.create(userId, {
      username,
      displayName: displayName || username,
      avatarKey,
    });
    return profile;
  }
}

export const profileRepository = new ProfileRepository();
