type ImageDimensions = { width?: number; height?: number };
type UploadRecord = {
  id: string;
  fileName?: string;
  size: number;
  mimeType: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
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

async function parseJsonResponse(response: Response): Promise<unknown> {
  const responseText = await response.text();
  let result: unknown;
  try {
    result = JSON.parse(responseText);
  } catch {
    result = responseText;
  }
  if (!response.ok) {
    const resultRecord = record(result);
    const message =
      typeof resultRecord.message === "string"
        ? resultRecord.message
        : `Upload failed with status ${response.status}`;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return result;
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
  const uploadUrl =
    typeof prepared.uploadUrl === "string" ? prepared.uploadUrl : "";
  const key = typeof prepared.key === "string" ? prepared.key : "";
  const cleanupToken =
    typeof prepared.cleanupToken === "string" ? prepared.cleanupToken : "";
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
    if (
      typeof committedRecord.id !== "string" ||
      typeof committedRecord.size !== "number" ||
      typeof committedRecord.mimeType !== "string"
    )
      throw new Error("Upload commit response is incomplete");
    result = {
      id: committedRecord.id,
      fileName:
        typeof committedRecord.fileName === "string"
          ? committedRecord.fileName
          : undefined,
      size: committedRecord.size,
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
