import { readonly } from "vue";
import { isExternalString } from "../shared/types/boundary.ts";

export interface ConfirmDialogOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface ConfirmDialogRequest {
  id: string;
  message: string;
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
}

let nextRequestId = 0;
const resolvers = new Map<string, (confirmed: boolean) => void>();

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function nativeConfirm(request: ConfirmDialogRequest): Promise<boolean> {
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(request.message, {
    title: request.title,
    kind: request.destructive ? "warning" : "info",
    okLabel: request.confirmLabel || "Continue",
    cancelLabel: request.cancelLabel || "Cancel",
  });
}

export function useConfirmDialog() {
  const activeRequest = useState<ConfirmDialogRequest | null>(
    "app-confirm-dialog-active",
    () => null,
  );
  const queuedRequests = useState<ConfirmDialogRequest[]>(
    "app-confirm-dialog-queue",
    () => [],
  );

  function showNextRequest() {
    if (activeRequest.value || !queuedRequests.value.length) return;
    activeRequest.value = queuedRequests.value.shift() || null;
  }

  function confirm(options: ConfirmDialogOptions | string): Promise<boolean> {
    if (!import.meta.client) return Promise.resolve(false);

    const normalized = isExternalString(options)
      ? { message: options }
      : options;
    const request: ConfirmDialogRequest = {
      id: `confirm-${Date.now()}-${nextRequestId++}`,
      message: normalized.message,
      title: normalized.title || "Confirm action",
      confirmLabel: normalized.confirmLabel || "Continue",
      cancelLabel: normalized.cancelLabel || "Cancel",
      destructive: Boolean(normalized.destructive),
    };

    if (hasTauriRuntime()) {
      return nativeConfirm(request).catch((error) => {
        console.warn("[ConfirmDialog] Native dialog failed:", error);
        return false;
      });
    }

    return new Promise((resolve) => {
      resolvers.set(request.id, resolve);
      queuedRequests.value.push(request);
      showNextRequest();
    });
  }

  function settle(confirmed: boolean) {
    const request = activeRequest.value;
    if (!request) return;

    activeRequest.value = null;
    const resolve = resolvers.get(request.id);
    resolvers.delete(request.id);
    resolve?.(confirmed);
    showNextRequest();
  }

  return {
    request: readonly(activeRequest),
    confirm,
    settle,
  };
}
