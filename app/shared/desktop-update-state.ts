import type {
  DesktopUpdate,
  DesktopUpdateStatus,
} from "./types/desktop-update.ts";

export function shouldShowDesktopUpdatePrompt({
  desktopRuntime,
  deferred,
  status,
  update,
}: {
  desktopRuntime: boolean;
  deferred: boolean;
  status: DesktopUpdateStatus;
  update: DesktopUpdate | null;
}): boolean {
  return (
    desktopRuntime && !deferred && (Boolean(update) || status === "installed")
  );
}

export function desktopUpdatePromptTitle(
  status: DesktopUpdateStatus,
  update: DesktopUpdate | null,
): string {
  if (status === "installed") return "dSpeak update installed";
  if (status === "error" && update)
    return "Unable to install the dSpeak update";
  if (status === "error") return "Unable to check for dSpeak updates";
  return "A dSpeak update is ready";
}
