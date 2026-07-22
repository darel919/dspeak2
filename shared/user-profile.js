export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 32;
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 32;
export const NICKNAME_MAX_LENGTH = 32;

function normalizedText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeDisplayName(value) {
  const name = normalizedText(value);
  if (
    name.length < DISPLAY_NAME_MIN_LENGTH ||
    name.length > DISPLAY_NAME_MAX_LENGTH
  )
    throw new Error(
      `Username must be ${DISPLAY_NAME_MIN_LENGTH}–${DISPLAY_NAME_MAX_LENGTH} characters`,
    );
  return name;
}

export function normalizeHandle(value) {
  const handle = String(value || "")
    .trim()
    .toLowerCase();
  if (handle.length < HANDLE_MIN_LENGTH || handle.length > HANDLE_MAX_LENGTH)
    throw new Error(
      `Username must be ${HANDLE_MIN_LENGTH}–${HANDLE_MAX_LENGTH} characters`,
    );
  if (!/^[a-z0-9_]+$/.test(handle))
    throw new Error(
      "Username may contain only lowercase letters, numbers, and underscores",
    );
  return handle;
}

export function normalizeNickname(value) {
  const nickname = normalizedText(value);
  if (nickname.length > NICKNAME_MAX_LENGTH)
    throw new Error(
      `Nickname must be ${NICKNAME_MAX_LENGTH} characters or less`,
    );
  return nickname;
}

export function publicDisplayName(user) {
  return (
    user?.display_name ||
    user?.name ||
    user?.username ||
    user?.email ||
    user?.id ||
    "Unknown user"
  );
}

export function profileIdentityLine(user, nickname) {
  const displayName = publicDisplayName(user);
  const personalNickname = normalizedText(nickname);

  if (!personalNickname) return displayName;
  if (personalNickname === normalizedText(displayName)) return displayName;
  return `${personalNickname} AKA ${displayName}`;
}
