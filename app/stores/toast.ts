import { defineStore } from "pinia";

export const useToastStore = defineStore("toast", () => {
  const toasts = ref([]);
  let nextId = 0;

  function addToast(type, message, duration = 3000) {
    const id = `${Date.now()}-${nextId++}`;
    toasts.value.push({ id, type, message, duration });
    if (duration > 0 && import.meta.client) {
      window.setTimeout(() => removeToast(id), duration);
    }
    return id;
  }

  function removeToast(id) {
    const index = toasts.value.findIndex((toast) => toast.id === id);
    if (index >= 0) toasts.value.splice(index, 1);
  }

  const success = (message, duration) => addToast("success", message, duration);
  const error = (message, duration) => addToast("error", message, duration);
  const warning = (message, duration) => addToast("warning", message, duration);
  const info = (message, duration) => addToast("info", message, duration);

  return { toasts, addToast, removeToast, success, error, warning, info };
});
