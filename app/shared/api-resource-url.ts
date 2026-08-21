export function resolveApiResourceUrl(
  value: string | null | undefined,
  apiPath: string | null | undefined,
): string {
  const resourcePath = String(value || "").trim();
  const configuredApiPath = String(apiPath || "").trim();
  if (!resourcePath || !configuredApiPath) return resourcePath;

  try {
    const apiUrl = new URL(configuredApiPath);
    if (apiUrl.protocol !== "http:" && apiUrl.protocol !== "https:")
      return resourcePath;
    const basePath = apiUrl.pathname.replace(/\/+$/, "") || "/";
    return new URL(resourcePath, `${apiUrl.origin}${basePath}/`).toString();
  } catch {
    return resourcePath;
  }
}

export async function loadApiResourceBlobUrl(
  value: string | null | undefined,
  apiPath: string | null | undefined,
): Promise<string> {
  const resourceUrl = resolveApiResourceUrl(value, apiPath);
  if (!resourceUrl) throw new Error("API resource URL is missing");
  const response = await globalThis.fetch(resourceUrl, {
    credentials: "include",
  });
  if (!response.ok)
    throw new Error(
      `API resource request failed with status ${response.status}`,
    );
  return URL.createObjectURL(await response.blob());
}
