export interface DesktopHttpProvenance {
  requestUrl: string;
  responseUrl: string;
  status: number;
  statusText: string;
  redirected: boolean;
  responseType: string;
  contentType: string;
  retryAfter: string;
  serverHeader: string;
  viaHeader: string;
  vercelRequestId: string;
  vercelMitigated: string;
  cloudflareRay: string;
  serverBuildCommit: string;
  serverProjectRef: string;
}

export interface NetworkProbeResult {
  transport: "webview-fetch" | "tauri-http";
  requestUrl: string;
  status: number | null;
  responseUrl: string;
  redirected: boolean;
  durationMs: number;
  errorName: string;
}

export function sanitizeResponseUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}

export async function nativeHttpFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  return tauriFetch(input, init);
}

export async function probeAuthTransport(
  apiPath: string,
): Promise<{ webview: NetworkProbeResult; tauri: NetworkProbeResult }> {
  const testUrl = `${apiPath.replace(/\/$/, "")}/update`;
  const start = performance.now();

  let webviewResult: NetworkProbeResult;
  try {
    const webviewStart = performance.now();
    const response = await globalThis.fetch(testUrl, { method: "GET" });
    webviewResult = {
      transport: "webview-fetch",
      requestUrl: testUrl,
      status: response.status,
      responseUrl: sanitizeResponseUrl(response.url),
      redirected: response.redirected,
      durationMs: performance.now() - webviewStart,
      errorName: "",
    };
  } catch (error) {
    webviewResult = {
      transport: "webview-fetch",
      requestUrl: testUrl,
      status: null,
      responseUrl: "",
      redirected: false,
      durationMs: performance.now() - start,
      errorName: error instanceof Error ? error.name : "unknown",
    };
  }

  let tauriResult: NetworkProbeResult;
  try {
    const tauriStart = performance.now();
    const response = await nativeHttpFetch(testUrl, { method: "GET" });
    tauriResult = {
      transport: "tauri-http",
      requestUrl: testUrl,
      status: response.status,
      responseUrl: sanitizeResponseUrl(response.url),
      redirected: response.redirected,
      durationMs: performance.now() - tauriStart,
      errorName: "",
    };
  } catch (error) {
    tauriResult = {
      transport: "tauri-http",
      requestUrl: testUrl,
      status: null,
      responseUrl: "",
      redirected: false,
      durationMs: performance.now() - start,
      errorName: error instanceof Error ? error.name : "unknown",
    };
  }

  return { webview: webviewResult, tauri: tauriResult };
}

export function extractProvenance(
  response: Response,
  requestUrl: string,
): DesktopHttpProvenance {
  return {
    requestUrl,
    responseUrl: sanitizeResponseUrl(response.url),
    status: response.status,
    statusText: response.statusText,
    redirected: response.redirected,
    responseType: response.type,
    contentType: response.headers.get("content-type") || "",
    retryAfter: response.headers.get("retry-after") || "",
    serverHeader: response.headers.get("server") || "",
    viaHeader: response.headers.get("via") || "",
    vercelRequestId: response.headers.get("x-vercel-id") || "",
    vercelMitigated: response.headers.get("x-vercel-mitigated") || "",
    cloudflareRay: response.headers.get("cf-ray") || "",
    serverBuildCommit: response.headers.get("x-dspeak-build-commit") || "",
    serverProjectRef: response.headers.get("x-dspeak-supabase-project") || "",
  };
}
