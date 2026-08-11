export function extractMeta(html, property) {
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapeRegex(property)}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const match = html.match(regex);
  if (match) return decodeHtmlEntities(match[1]);
  const altRegex = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escapeRegex(property)}["']`,
    "i",
  );
  const altMatch = html.match(altRegex);
  return altMatch ? decodeHtmlEntities(altMatch[1]) : "";
}

export function extractTitle(html) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]) : "";
}

export function extractFavicon(html, baseUrl) {
  const match = html.match(
    /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']*)["']/i,
  );
  if (!match) {
    try {
      return new URL("/favicon.ico", baseUrl).href;
    } catch {
      return "";
    }
  }
  try {
    return new URL(match[1], baseUrl).href;
  } catch {
    return match[1];
  }
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}
