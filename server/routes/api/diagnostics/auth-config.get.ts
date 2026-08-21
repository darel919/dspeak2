import { normalizeCommit } from "../../../../shared/app-build.ts";
import { parseExternalString } from "../../../../shared/types/external.ts";
import { configuredSupabaseProjectRef } from "../../../auth/supabase.ts";

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event);
  const serverBuildCommit =
    normalizeCommit(
      parseExternalString(runtimeConfig.public?.appBuild?.shortCommit),
      { short: true },
    ) ?? "";

  return {
    buildCommit: serverBuildCommit,
    supabaseProjectRef: configuredSupabaseProjectRef,
    supabaseUrlConfigured: Boolean(process.env.SUPABASE_URL),
    supabaseAnonKeyConfigured: Boolean(process.env.SUPABASE_ANON_KEY),
    supabaseServiceRoleKeyConfigured: Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
  };
});
