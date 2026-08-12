export interface DesktopUpdate {
  version?: string;
  [key: string]: unknown;
}
export type DesktopUpdateStatus =
  "idle" | "checking" | "installing" | "complete" | "installed" | "error";
export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  update: DesktopUpdate | null;
  error: unknown;
  deferred: boolean;
}
