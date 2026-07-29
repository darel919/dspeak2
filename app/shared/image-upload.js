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

export async function uploadChatFile(
  file,
  channelId,
  apiPath,
  dimensions = {},
) {
  const path = apiPath || "/api";
  const formData = new FormData();
  formData.append("file", file);
  formData.append("channelId", channelId);
  formData.append("width", String(dimensions.width || 0));
  formData.append("height", String(dimensions.height || 0));

  const response = await fetch(`${path}/chat/upload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

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
    throw new Error(message);
  }
  return result;
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
  const imageFiles = [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }
  return imageFiles;
}

export function getImagesFromDrag(event) {
  const files = Array.from(event.dataTransfer?.files || []);
  return files.filter((file) => file.type.startsWith("image/"));
}
