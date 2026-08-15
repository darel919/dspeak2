import assert from "node:assert/strict";
import test from "node:test";

const testDatabaseUrl = process.env.DSPEAK_TEST_DATABASE_URL || "";
const enabled = Boolean(testDatabaseUrl);

let profileRepository: (typeof import("../server/db/repositories/profiles.ts"))["profileRepository"];
let EmailIdentityConflictError: (typeof import("../server/auth/email-identity-conflict.ts"))["EmailIdentityConflictError"];

if (enabled) {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  if (!previousSupabaseUrl)
    process.env.SUPABASE_URL = "https://project.supabase.co";
  const previousSupabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!previousSupabaseAnonKey) process.env.SUPABASE_ANON_KEY = "test-anon-key";
  const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!previousServiceRole)
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

  const imported = await import("../server/db/repositories/profiles.ts");
  profileRepository = imported.profileRepository;
  const { EmailIdentityConflictError: ImportedConflictError } =
    await import("../server/auth/email-identity-conflict.ts");
  EmailIdentityConflictError = ImportedConflictError;

  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
  if (previousSupabaseAnonKey === undefined)
    delete process.env.SUPABASE_ANON_KEY;
  if (previousServiceRole === undefined)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

const skipMessage =
  "set DSPEAK_TEST_DATABASE_URL to a disposable test database (schema applied)";

test(
  "first login creates both users and profiles rows",
  { skip: !enabled && skipMessage },
  async () => {
    const id = crypto.randomUUID();
    const profile = await profileRepository.getOrCreateOnFirstLogin(id, {
      email: `first-${id}@test.example`,
      displayName: "First Login",
      avatarKey: null,
    });
    assert.ok(profile);
    assert.equal(profile.id, id);
    const again = await profileRepository.getOrCreateOnFirstLogin(id, {
      email: `first-${id}@test.example`,
      displayName: "First Login",
      avatarKey: null,
    });
    assert.equal(again.id, id);
  },
);

test(
  "existing account reuse is idempotent",
  { skip: !enabled && skipMessage },
  async () => {
    const id = crypto.randomUUID();
    await profileRepository.getOrCreateOnFirstLogin(id, {
      email: `reuse-${id}@test.example`,
      displayName: "Reuse",
      avatarKey: null,
    });
    const second = await profileRepository.getOrCreateOnFirstLogin(id, {
      email: `reuse-${id}@test.example`,
      displayName: "Reuse",
      avatarKey: null,
    });
    assert.equal(second.id, id);
  },
);

test(
  "same email with a different UUID maps to EmailIdentityConflictError",
  { skip: !enabled && skipMessage },
  async () => {
    const firstId = crypto.randomUUID();
    const email = `conflict-${crypto.randomUUID()}@test.example`;
    await profileRepository.getOrCreateOnFirstLogin(firstId, {
      email,
      displayName: "Conflict A",
      avatarKey: null,
    });
    const secondId = crypto.randomUUID();
    await assert.rejects(
      () =>
        profileRepository.getOrCreateOnFirstLogin(secondId, {
          email,
          displayName: "Conflict B",
          avatarKey: null,
        }),
      (error: unknown) => error instanceof EmailIdentityConflictError,
    );
  },
);
