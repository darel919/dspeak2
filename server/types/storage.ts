import type { PutObjectCommandInput } from "@aws-sdk/client-s3";

export type R2ObjectTypeName =
  | "avatar"
  | "room-profile"
  | "room-header"
  | "chat"
  | "soundboard"
  | "album-art";

export interface R2ObjectIdentifiers {
  userId?: string;
  roomId?: string;
  channelId?: string;
  messageId?: string;
  objectId: string;
  contentHash?: string;
}

export interface R2UploadResult {
  uploadUrl: string;
  key: string;
  expiresIn: number;
}

export interface R2ObjectRecord {
  key: string;
  lastModified: Date | null;
}

export type R2Body = PutObjectCommandInput["Body"];

export type R2UploadBody = R2Body | Blob;

export interface UploadValidationResult {
  valid: boolean;
  error?: string;
}
