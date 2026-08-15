export type DesktopSessionDiagnostic = {
  diagnosticCategory: string;
  serverBuildCommit: string;
  httpStatus: number;
  serverProjectRef: string;
};

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
