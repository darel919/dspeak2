const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function parseHttpUrl(value: string): URL {
  const url = new URL(String(value));
  if (!HTTP_PROTOCOLS.has(url.protocol))
    throw new Error("External URL must use HTTP or HTTPS");
  if (url.hostname === "tauri.localhost")
    throw new Error("External URL cannot target the Tauri application origin");
  return url;
}

export function buildPublicUrl(publicOrigin: string, path: string): string {
  const origin = parseHttpUrl(publicOrigin);
  const normalizedPath = String(path || "");
  if (!normalizedPath.startsWith("/"))
    throw new Error("Public URL paths must start with a slash");
  const url = new URL(normalizedPath, `${origin.origin}/`);
  if (url.origin !== origin.origin)
    throw new Error("Public URL path escaped the configured origin");
  return url.toString();
}

export async function openExternalUrl(
  value: string,
  desktop = false,
): Promise<void> {
  const url = parseHttpUrl(value).toString();
  if (desktop) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  if (import.meta.client) window.open(url, "_blank", "noopener,noreferrer");
}
