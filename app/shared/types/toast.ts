export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastRecord {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}
