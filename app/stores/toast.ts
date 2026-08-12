import { defineStore } from "pinia";
import type { ToastRecord, ToastType } from "../shared/types/toast.ts";

export const useToastStore = defineStore("toast", () => {
  const toasts = ref<ToastRecord[]>([]);
  let nextId = 0;

  function addToast(type: ToastType, message: string, duration = 3000): string {
    const id = `${Date.now()}-${nextId++}`;
    toasts.value.push({ id, type, message, duration });
    if (duration > 0 && import.meta.client) {
      window.setTimeout(() => removeToast(id), duration);
    }
    return id;
  }

  function removeToast(id: string): void {
    const index = toasts.value.findIndex((toast) => toast.id === id);
    if (index >= 0) toasts.value.splice(index, 1);
  }

  const success = (message: string, duration?: number) =>
    addToast("success", message, duration);
  const error = (message: string, duration?: number) =>
    addToast("error", message, duration);
  const warning = (message: string, duration?: number) =>
    addToast("warning", message, duration);
  const info = (message: string, duration?: number) =>
    addToast("info", message, duration);

  return { toasts, addToast, removeToast, success, error, warning, info };
});
