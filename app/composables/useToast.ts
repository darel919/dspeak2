export function useToast() {
  const store = useToastStore();
  const { toasts } = storeToRefs(store);
  return {
    toasts: readonly(toasts),
    addToast: store.addToast,
    removeToast: store.removeToast,
    success: store.success,
    error: store.error,
    warning: store.warning,
    info: store.info,
  };
}
