import { supabase } from "../../../auth/supabase.js";

export default defineEventHandler(async (event) => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw createError({ statusCode: 400, statusMessage: error.message });
  }

  return { success: true };
});
