import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  R2Body,
  R2ObjectIdentifiers,
  R2ObjectRecord,
  R2ObjectTypeName,
  R2UploadResult,
  UploadValidationResult,
} from "../types/storage.ts";
import type { ExternalField } from "../../shared/types/external.ts";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for R2 storage`);
  return value;
}

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${requiredEnvironment("CF_R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: requiredEnvironment("CF_R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("CF_R2_SECRET_ACCESS_KEY"),
  },
});

const BUCKET = process.env.CF_R2_BUCKET_NAME || "dspeak";

export function generateObjectKey(
  type: R2ObjectTypeName,
  identifiers: R2ObjectIdentifiers,
): string {
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
  type: R2ObjectTypeName,
  identifiers: R2ObjectIdentifiers,
  contentType: string,
  maxSizeBytes = 50 * 1024 * 1024,
): Promise<R2UploadResult> {
  void maxSizeBytes;
  const key = generateObjectKey(type, identifiers);
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
  return { uploadUrl, key, expiresIn: 3600 };
}

export async function putObject(
  key: string,
  body: R2Body,
  contentType: string,
  contentLength: number | null | undefined,
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    ContentLength: contentLength ?? undefined,
  });
  await r2Client.send(command);
}

export async function createDownloadUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(r2Client, command, { expiresIn });
}

export async function deleteObject(key: string): Promise<void> {
  const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
  await r2Client.send(command);
}

export async function listObjects(prefix: string): Promise<R2ObjectRecord[]> {
  const objects: R2ObjectRecord[] = [];
  let continuationToken: string | undefined;
  do {
    const result: ListObjectsV2CommandOutput = await r2Client.send(
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

export async function objectExists(key: string): Promise<boolean> {
  try {
    await getObjectMetadata(key);
    return true;
  } catch {
    return false;
  }
}

export async function getObjectMetadata(
  key: string,
): Promise<{ contentLength: number; contentType: string }> {
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
  type: R2ObjectTypeName,
  mimeType: string,
  size: ExternalField,
  maxSizeBytes = 50 * 1024 * 1024,
): UploadValidationResult {
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
