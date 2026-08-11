import { revokeAuthenticatedSession } from "../../../utils/auth.ts";

export default defineEventHandler(async (event) => {
  return revokeAuthenticatedSession(event);
});
