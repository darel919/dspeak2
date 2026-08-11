function parsePayload(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function firstMessage(payload) {
  const candidates = [
    payload?.statusMessage,
    payload?.message,
    payload?.data?.statusMessage,
    payload?.data?.message,
  ];

  return candidates.find(
    (message) => typeof message === "string" && message.trim(),
  );
}

function isStackTrace(value) {
  return /^Error(?::|\s)/i.test(value) || /\n\s*at\s+/.test(value);
}

export function apiErrorMessage(value, status, fallback = "Request failed") {
  const payload = parsePayload(value);
  const message = firstMessage(payload);
  if (message) return message.trim();

  if (!payload && typeof value === "string" && value.trim()) {
    const text = value.trim();
    if (!isStackTrace(text)) return text;
  }

  return status ? `${fallback} (${status})` : fallback;
}
