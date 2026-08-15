export type DesktopSessionDiagnostic = {
  diagnosticCategory: string;
  serverBuildCommit: string;
};

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
  };
}
