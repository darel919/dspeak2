import { configuredSupabaseProjectRef } from "../../../auth/supabase.ts";
import { profileRepository } from "../../../db/repositories/profiles.ts";

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event);
  const serverBuildCommit =
    typeof runtimeConfig.public?.appBuild?.shortCommit === "string"
      ? runtimeConfig.public.appBuild.shortCommit
      : "";

  const hasSupabaseUrl = Boolean(process.env.SUPABASE_URL);
  const hasSupabaseAnonKey = Boolean(process.env.SUPABASE_ANON_KEY);
  const hasSupabaseServiceRoleKey = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

  let databaseConfigured = false;
  try {
    if (hasDatabaseUrl) {
      await profileRepository.findById("00000000-0000-0000-0000-000000000000");
      databaseConfigured = true;
    }
  } catch {
    databaseConfigured = false;
  }

  return {
    buildCommit: serverBuildCommit,
    supabaseProjectRef: configuredSupabaseProjectRef,
    databaseConfigured,
    supabaseUrlConfigured: hasSupabaseUrl,
    supabaseAnonKeyConfigured: hasSupabaseAnonKey,
    supabaseServiceRoleKeyConfigured: hasSupabaseServiceRoleKey,
    databaseUrlConfigured: hasDatabaseUrl,
  };
});
