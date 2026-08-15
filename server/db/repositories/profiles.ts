import { db } from "../client.ts";
import { profiles, users } from "../schema/index.ts";
import { and, eq, ne } from "drizzle-orm";
import { generateRandomUsername } from "../../auth/random-username.ts";
import { EmailIdentityConflictError } from "../../auth/email-identity-conflict.ts";
import type {
  FirstLoginInput,
  ProfileInsertInput,
  ProfileUpdateInput,
} from "../../types/profile-repository.ts";

export { EmailIdentityConflictError } from "../../auth/email-identity-conflict.ts";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const usernameRetryLimit = 3;
const usernameCandidateLimit = 10;

async function findAvailableUsername(
  tx: DatabaseTransaction,
  userId: string,
): Promise<string> {
  for (let counter = 0; counter < usernameCandidateLimit; counter += 1) {
    const candidate = generateRandomUsername();
    const [userConflict] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, candidate), ne(users.id, userId)))
      .limit(1);
    if (userConflict) continue;

    const [profileConflict] = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.username, candidate), ne(profiles.id, userId)))
      .limit(1);
    if (!profileConflict) return candidate;
  }
  throw new Error("Unable to allocate a unique username");
}

function isUsernameConflict(error: unknown): boolean {
  const value = error as {
    constraint_name?: string;
    cause?: { constraint_name?: string; code?: string };
    code?: string;
  };
  const constraint =
    value.constraint_name || value.cause?.constraint_name || "";
  const sqlState = value.code || value.cause?.code || "";
  if (sqlState !== "23505") return false;
  return (
    constraint === "users_username_unique" ||
    constraint === "profiles_username_unique"
  );
}

function isEmailConflict(error: unknown): boolean {
  const value = error as {
    constraint_name?: string;
    cause?: { constraint_name?: string; code?: string };
    code?: string;
  };
  const constraint =
    value.constraint_name || value.cause?.constraint_name || "";
  const sqlState = value.code || value.cause?.code || "";
  if (sqlState !== "23505") return false;
  return constraint === "users_email_unique";
}

export class ProfileRepository {
  async findById(id: string) {
    const result = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, id))
      .limit(1);
    return result[0] || null;
  }

  async findByUsername(username: string) {
    const result = await db
      .select()
      .from(profiles)
      .where(eq(profiles.username, username))
      .limit(1);
    return result[0] || null;
  }

  async create(
    id: string,
    { username, displayName, avatarKey }: ProfileInsertInput,
  ) {
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

  async update(
    id: string,
    { username, displayName, avatarKey }: ProfileUpdateInput,
  ) {
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
    userId: string,
    { email, displayName, avatarKey }: FirstLoginInput,
  ) {
    for (let attempt = 0; attempt < usernameRetryLimit; attempt += 1) {
      try {
        return await db.transaction(async (tx) => {
          let profile = await tx
            .select()
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);
          if (profile[0]) return profile[0];

          const username = await findAvailableUsername(tx, userId);

          await tx
            .insert(users)
            .values({
              id: userId,
              email,
              name: displayName || null,
              username,
              displayName: displayName || null,
            })
            .onConflictDoNothing({ target: users.id });

          profile = await tx
            .insert(profiles)
            .values({
              id: userId,
              username,
              displayName: displayName || username,
              avatarKey,
            })
            .onConflictDoNothing({ target: profiles.id })
            .returning();
          if (profile[0]) return profile[0];

          profile = await tx
            .select()
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);
          if (profile[0]) return profile[0];
          throw new Error("OAuth profile could not be created");
        });
      } catch (error: unknown) {
        if (isEmailConflict(error)) throw new EmailIdentityConflictError(email);
        if (!isUsernameConflict(error) || attempt === usernameRetryLimit - 1)
          throw error;
      }
    }

    throw new Error("OAuth profile could not be provisioned");
  }
}

export const profileRepository = new ProfileRepository();
