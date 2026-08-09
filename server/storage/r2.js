import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME || "dspeak";

export function generateObjectKey(type, identifiers) {
  const { userId, roomId, channelId, messageId, objectId, contentHash } =
    identifiers;
  switch (type) {
    case "avatar":
      return `avatars/${userId}/${objectId}`;
    case "room-profile":
      return `rooms/${roomId}/profile/${objectId}`;
    case "room-header":
      return `rooms/${roomId}/headers/${objectId}`;
    case "chat":
      return `chat/${channelId}/${messageId || "pending"}/${objectId}`;
    case "soundboard":
      return `soundboards/${roomId}/${objectId}`;
    case "album-art":
      return `album-art/${contentHash}`;
    default:
      return `misc/${objectId}`;
  }
}

export async function createUploadUrl(
  type,
  identifiers,
  contentType,
  maxSizeBytes = 50 * 1024 * 1024,
) {
  const key = generateObjectKey(type, identifiers);
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
  return { uploadUrl, key, expiresIn: 3600 };
}

export async function putObject(key, body, contentType, contentLength) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    ...(contentLength == null ? {} : { ContentLength: contentLength }),
  });
  await r2Client.send(command);
}

export async function createDownloadUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(r2Client, command, { expiresIn });
}

export async function deleteObject(key) {
  const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
  await r2Client.send(command);
}

export async function listObjects(prefix) {
  const objects = [];
  let continuationToken;
  do {
    const result = await r2Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of result.Contents || [])
      if (object.Key)
        objects.push({
          key: object.Key,
          lastModified: object.LastModified || null,
        });
    continuationToken = result.IsTruncated
      ? result.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return objects;
}

export async function objectExists(key) {
  try {
    await getObjectMetadata(key);
    return true;
  } catch {
    return false;
  }
}

export async function getObjectMetadata(key) {
  const command = new HeadObjectCommand({ Bucket: BUCKET, Key: key });
  const result = await r2Client.send(command);
  return {
    contentLength: Number(result.ContentLength),
    contentType: String(result.ContentType || "").toLowerCase(),
  };
}

export const R2ObjectType = {
  AVATAR: "avatar",
  ROOM_PROFILE: "room-profile",
  ROOM_HEADER: "room-header",
  CHAT: "chat",
  SOUNDBOARD: "soundboard",
  ALBUM_ART: "album-art",
};

export const ALLOWED_MIME_TYPES = {
  [R2ObjectType.AVATAR]: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  [R2ObjectType.ROOM_PROFILE]: ["image/jpeg", "image/png", "image/webp"],
  [R2ObjectType.ROOM_HEADER]: ["image/jpeg", "image/png", "image/webp"],
  [R2ObjectType.CHAT]: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "audio/mpeg",
    "audio/ogg",
    "application/pdf",
  ],
  [R2ObjectType.SOUNDBOARD]: ["audio/mpeg", "audio/ogg", "audio/wav"],
  [R2ObjectType.ALBUM_ART]: ["image/jpeg", "image/png", "image/webp"],
};

export function validateUpload(
  type,
  mimeType,
  size,
  maxSizeBytes = 50 * 1024 * 1024,
) {
  const allowed = ALLOWED_MIME_TYPES[type];
  if (!allowed?.includes(mimeType)) {
    return {
      valid: false,
      error: `MIME type ${mimeType} not allowed for ${type}`,
    };
  }
  const normalizedSize = Number(size);
  if (!Number.isSafeInteger(normalizedSize) || normalizedSize <= 0) {
    return { valid: false, error: "File size must be a positive integer" };
  }
  if (normalizedSize > maxSizeBytes) {
    return { valid: false, error: `File size exceeds ${maxSizeBytes} bytes` };
  }
  return { valid: true };
}
