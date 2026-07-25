export function profileAssetUrl(path) {
  if (!path) return null;

  const value = String(path).trim();
  if (!value) return null;
  if (value.startsWith("blob:")) return value;
  try {
    const url = new URL(value, "https://avatar.invalid");
    if (
      url.pathname.endsWith("/auth/assets/avatar") ||
      url.pathname === "/api/assets/avatar"
    ) {
      const userId = url.searchParams.get("userId");
      const fileName = url.searchParams.get("fileName");
      if (!userId || !fileName) return null;
      return `/api/assets/avatar?userId=${encodeURIComponent(userId)}&fileName=${encodeURIComponent(fileName)}`;
    }
  } catch {
    return null;
  }
  if (/^(?:https?:)?\/\//i.test(value)) return null;
  if (value.startsWith("/")) return value;

  const assetPath = value.replace(/^\/+/, "");
  const normalizedPath = assetPath.startsWith("auth/assets/")
    ? `/api/${assetPath.slice("auth/".length)}`
    : assetPath.startsWith("assets/avatar")
      ? `/api/${assetPath}`
      : null;

  return normalizedPath;
}

export function profileInitials(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
