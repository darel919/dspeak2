import { revokeAuthenticatedSession } from "../../../utils/auth.js";

export default defineEventHandler(async (event) => {
  return revokeAuthenticatedSession(event);
});
