import { requireAuth } from "../../../auth/middleware.js";
import {
  createUploadUrl,
  validateUpload,
  R2ObjectType,
} from "../../../storage/r2.js";

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  const user = event.context.user;

  const body = await readBody(event);
  const { type, identifiers, mimeType, size } = body;

  if (!type || !identifiers || !mimeType || !size) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields",
    });
  }

  const validation = validateUpload(type, mimeType, size);
  if (!validation.valid) {
    throw createError({ statusCode: 400, statusMessage: validation.error });
  }

  identifiers.userId = identifiers.userId || user.id;

  const result = await createUploadUrl(type, identifiers, mimeType);

  return {
    uploadUrl: result.uploadUrl,
    key: result.key,
    expiresIn: result.expiresIn,
  };
});
