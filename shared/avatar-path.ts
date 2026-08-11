export function avatarFileName(value: unknown) {
  const avatar = String(value || "").trim();
  if (!avatar) return "";
  if (!avatar.includes("/") && !avatar.includes("?")) return avatar;

  try {
    const url = new URL(avatar, "https://avatar.invalid");
    if (
      !url.pathname.endsWith("/auth/assets/avatar") &&
      url.pathname !== "/api/assets/avatar"
    )
      return "";
    const requestedFileName = url.searchParams.get("fileName");
    if (requestedFileName) return requestedFileName;
  } catch {
    return "";
  }
  return "";
}

export function sameOriginAvatarPath(
  user: { id?: unknown; avatar?: unknown } | null | undefined,
) {
  const userId = String(user?.id || "").trim();
  const fileName = avatarFileName(user?.avatar);
  if (!userId || !fileName) return null;
  return `/api/assets/avatar?userId=${encodeURIComponent(userId)}&fileName=${encodeURIComponent(fileName)}`;
}
