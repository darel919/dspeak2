import { isExternalRecord, isExternalString } from "./types/boundary.ts";

type ImageDimensions = { width?: number; height?: number };
type UploadRecord = {
  id: string;
  fileName?: string;
  size: number;
  mimeType: string;
};

function record<T>(value: T): Record<string, unknown> {
  return isExternalRecord(value) ? value : {};
}

export function validateImageFile(file: File | null | undefined) {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const maxSize = 10 * 1024 * 1024;

  if (!file) return { valid: false, error: "No file provided" };
  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: "File must be JPEG, PNG, WebP, or GIF" };
  }
  if (file.size > maxSize)
    return { valid: false, error: "File must be under 10MB" };
  return { valid: true };
}

export function readFileAsDataURL(
  file: File,
): Promise<string | ArrayBuffer | null> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function getImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}

async function parseJsonResponse(
  response: Response,
): Promise<Record<string, unknown> | string> {
  const responseText = await response.text();
  let result: unknown;
  try {
    result = JSON.parse(responseText);
  } catch {
    if (!response.ok)
      throw Object.assign(
        new Error(`Upload failed with status ${response.status}`),
        { status: response.status },
      );
    return responseText;
  }
  if (isExternalRecord(result)) {
    if (!response.ok) {
      const message = isExternalString(result.message)
        ? result.message
        : `Upload failed with status ${response.status}`;
      throw Object.assign(new Error(message), { status: response.status });
    }
    return result;
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(`Upload failed with status ${response.status}`),
      { status: response.status },
    );
  }
  return responseText;
}

export async function uploadChatFile(
  file: File,
  channelId: string,
  apiPath: string,
  dimensions: ImageDimensions = {},
) {
  const path = apiPath || "/api";
  const objectId = crypto.randomUUID();
  const prepare = await fetch(`${path}/files/prepare`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "chat",
      identifiers: { channelId, objectId },
      mimeType: file.type,
      size: file.size,
    }),
  });
  const prepared = record(await parseJsonResponse(prepare));
  const uploadUrl = isExternalString(prepared.uploadUrl)
    ? prepared.uploadUrl
    : "";
  const key = isExternalString(prepared.key) ? prepared.key : "";
  const cleanupToken = isExternalString(prepared.cleanupToken)
    ? prepared.cleanupToken
    : "";
  if (!uploadUrl || !key || !cleanupToken)
    throw new Error("Upload preparation response is incomplete");

  const putResponse = await fetch(uploadUrl, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putResponse.ok)
    throw new Error(`R2 upload failed with status ${putResponse.status}`);

  let result: UploadRecord;
  try {
    const commit = await fetch(`${path}/files/commit`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "chat",
        key,
        metadata: {
          channelId,
          objectId,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          width: dimensions.width || 0,
          height: dimensions.height || 0,
        },
      }),
    });
    const committed = record(await parseJsonResponse(commit));
    const committedRecord = record(committed.record);
    const committedSize = Number(committedRecord.size);
    if (
      !isExternalString(committedRecord.id) ||
      !Object.is(committedRecord.size, committedSize) ||
      !Number.isFinite(committedSize) ||
      !isExternalString(committedRecord.mimeType)
    )
      throw new Error("Upload commit response is incomplete");
    result = {
      id: committedRecord.id,
      fileName: isExternalString(committedRecord.fileName)
        ? committedRecord.fileName
        : undefined,
      size: committedSize,
      mimeType: committedRecord.mimeType,
    };
  } catch (error) {
    await cleanupPreparedUpload(cleanupToken, path);
    throw error;
  }

  return {
    id: result.id,
    url: `/api/assets/chat-file?id=${encodeURIComponent(result.id)}`,
    name: result.fileName || file.name,
    size: result.size,
    mime_type: result.mimeType,
    width: dimensions.width || 0,
    height: dimensions.height || 0,
  };
}

async function cleanupPreparedUpload(cleanupToken: string, path: string) {
  try {
    await fetch(`${path}/files/cleanup`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cleanupToken }),
    });
  } catch {}
}

export async function deleteChatFile(fileId: string, apiPath: string) {
  const path = apiPath || "/api";
  const response = await fetch(`${path}/chat/upload`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
  if (!response.ok) throw new Error("Could not remove abandoned upload");
}

export function getImagesFromClipboard(event: ClipboardEvent): File[] {
  const items = event.clipboardData?.items || [];
  const imageFiles: File[] = [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }
  return imageFiles;
}

export function getImagesFromDrag(event: DragEvent): File[] {
  const files = Array.from(event.dataTransfer?.files || []);
  return files.filter((file) => file.type.startsWith("image/"));
}
