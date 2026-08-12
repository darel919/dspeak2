const INVITE_URL_PATTERN = /^<?(https?:\/\/[^\s<>]+)>?$/i;
const MARKDOWN_INVITE_PATTERN = /^\[[^\]]*\]\((https?:\/\/[^)\s]+)\)$/i;

function trimUrlPunctuation(value: string) {
  return value.replace(/[.,!?;:)\]}]+$/g, "");
}

export function extractInviteLink(
  value: unknown,
  allowedOrigin?: string | null,
) {
  if (typeof value !== "string" || !value.trim()) return null;

  const content = value.trim();
  const markdownMatch = content.match(MARKDOWN_INVITE_PATTERN);
  const plainMatch = content.match(INVITE_URL_PATTERN);
  const candidate = trimUrlPunctuation(
    markdownMatch?.[1] || plainMatch?.[1] || "",
  );
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (allowedOrigin && url.origin !== new URL(allowedOrigin).origin)
      return null;

    const tokenMatch = url.pathname.match(/^\/join\/([^/]+)\/?$/);
    if (!tokenMatch) return null;

    const tokenValue = tokenMatch[1];
    if (!tokenValue) return null;
    const token = decodeURIComponent(tokenValue);
    if (!token || token.includes("/")) return null;

    return { token, url: url.href };
  } catch {
    return null;
  }
}
