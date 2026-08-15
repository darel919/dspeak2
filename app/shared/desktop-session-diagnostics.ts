export type DesktopSessionDiagnostic = {
  diagnosticCategory: string;
  serverBuildCommit: string;
  httpStatus: number;
  serverProjectRef: string;
};

export type DesktopFailureDiagnostic = {
  code: string;
  stage: string;
  httpStatus: number | null;
  serverBuildCommit: string;
  clientBuildCommit: string;
  serverProjectRef: string;
  clientProjectRef: string;
};

export function mapFailureDiagnostic(
  error: unknown,
): DesktopFailureDiagnostic | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const serverDiagnostic =
    typeof record.serverDiagnostic === "string" ? record.serverDiagnostic : "";
  const code =
    serverDiagnostic ||
    (typeof record.code === "string" ? record.code : "") ||
    (typeof record.name === "string" && record.name.startsWith("DESKTOP_")
      ? record.name
      : "");
  const hasCode =
    code || typeof record.message === "string" || error instanceof Error;
  if (!hasCode) return null;
  return {
    code: code || "DESKTOP_AUTH_UNKNOWN_ERROR",
    stage: typeof record.stage === "string" ? record.stage : "unknown",
    httpStatus:
      typeof record.httpStatus === "number" && record.httpStatus > 0
        ? record.httpStatus
        : null,
    serverBuildCommit:
      typeof record.serverBuildCommit === "string"
        ? record.serverBuildCommit
        : "",
    clientBuildCommit:
      typeof record.clientBuildCommit === "string"
        ? record.clientBuildCommit
        : "",
    serverProjectRef:
      typeof record.serverProjectRef === "string"
        ? record.serverProjectRef
        : "",
    clientProjectRef:
      typeof record.clientProjectRef === "string"
        ? record.clientProjectRef
        : "",
  };
}

export function supabaseProjectRef(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

export async function readDesktopSessionDiagnostic(
  response: Response,
): Promise<DesktopSessionDiagnostic> {
  let diagnosticCategory = response.statusText || "http-error";
  try {
    const payload = (await response.clone().json()) as {
      statusMessage?: unknown;
      message?: unknown;
    };
    const category = payload.statusMessage || payload.message;
    if (typeof category === "string" && category) diagnosticCategory = category;
  } catch {}
  return {
    diagnosticCategory,
    serverBuildCommit: response.headers.get("X-dSpeak-Build-Commit") || "",
    httpStatus: response.status,
    serverProjectRef: response.headers.get("X-dSpeak-Supabase-Project") || "",
  };
}
