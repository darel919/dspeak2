export function validateImageFile(file) {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const maxSize = 10 * 1024 * 1024;

  if (!file) return { valid: false, error: "No file provided" };
  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: "File must be JPEG, PNG, WebP, or GIF" };
  }
  if (file.size > maxSize) {
    return { valid: false, error: "File must be under 10MB" };
  }
  return { valid: true };
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function getImageDimensions(file) {
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

async function parseJsonResponse(response) {
  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    result = responseText;
  }
  if (!response.ok) {
    const message =
      result?.message || `Upload failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return result;
}

export async function uploadChatFile(
  file,
  channelId,
  apiPath,
  dimensions = {} as any,
) {
  const path = apiPath || "/api";
  const objectId = crypto.randomUUID();

  const prepare = await fetch(`${path}/files/prepare`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "chat",
      identifiers: {
        channelId,
        objectId,
      },
      mimeType: file.type,
      size: file.size,
    }),
  });
  const { uploadUrl, key, cleanupToken } = await parseJsonResponse(prepare);

  const putResponse = await fetch(uploadUrl, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putResponse.ok) {
    throw new Error(`R2 upload failed with status ${putResponse.status}`);
  }

  let record;
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
    record = await parseJsonResponse(commit);
  } catch (error) {
    await cleanupPreparedUpload(cleanupToken, path);
    throw error;
  }

  return {
    id: record.record.id,
    url: `/api/assets/chat-file?id=${encodeURIComponent(record.record.id)}`,
    name: record.record.fileName || file.name,
    size: record.record.size,
    mime_type: record.record.mimeType,
    width: dimensions.width || 0,
    height: dimensions.height || 0,
  };
}

async function cleanupPreparedUpload(cleanupToken, path) {
  try {
    await fetch(`${path}/files/cleanup`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cleanupToken }),
    });
  } catch {}
}

export async function deleteChatFile(fileId, apiPath) {
  const path = apiPath || "/api";
  const response = await fetch(`${path}/chat/upload`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
  if (!response.ok) throw new Error("Could not remove abandoned upload");
}

export function getImagesFromClipboard(event) {
  const items = event.clipboardData?.items || [];
  const imageFiles = [] as any;
  for (const item of items as any[]) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }
  return imageFiles;
}

export function getImagesFromDrag(event) {
  const files = Array.from(event.dataTransfer?.files || []);
  return files.filter((file: any) => file.type.startsWith("image/"));
}
