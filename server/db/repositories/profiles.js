import { db } from "../client.js";
import { profiles, users } from "../schema/index.js";
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
    return db.transaction(async (tx) => {
      await tx
        .insert(users)
        .values({
          id: userId,
          email,
          name: displayName || null,
          username: preferredUsername || null,
          displayName: displayName || null,
        })
        .onConflictDoNothing({ target: users.id });

      let profile = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      if (profile[0]) return profile[0];

      let username = preferredUsername || email.split("@")[0];
      let counter = 1;
      while (true) {
        const existing = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.username, username))
          .limit(1);
        if (!existing[0]) break;
        username = `${preferredUsername || email.split("@")[0]}${counter}`;
        counter++;
      }

      profile = await tx
        .insert(profiles)
        .values({
          id: userId,
          username,
          displayName: displayName || username,
          avatarKey,
        })
        .returning();
      return profile[0];
    });
  }
}

export const profileRepository = new ProfileRepository();
