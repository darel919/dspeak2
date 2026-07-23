export function profileAssetUrl(path, baseApiPath = "") {
  if (!path) return null;

  const value = String(path).trim();
  if (!value) return null;
  if (/^(?:https?:)?\/\//i.test(value) || value.startsWith("blob:"))
    return value;
  if (value.startsWith("/")) return value;

  const base = String(baseApiPath).replace(/\/+$/, "");
  const assetPath = value.replace(/^\/+/, "");
  const normalizedPath = assetPath.startsWith("auth/")
    ? assetPath
    : assetPath.startsWith("assets/")
      ? `auth/${assetPath}`
      : `files/${assetPath}`;

  return `${base}/${normalizedPath}`;
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
