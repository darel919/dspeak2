export function useNotifications() {
  const store = useNotificationsStore();
  const { notificationSupported, permission, isEnabled } = storeToRefs(store);

  if (import.meta.client) {
    const authStore = useAuthStore();
    let stopAuthWatch = null;
    const initializeForUser = (userId) => {
      if (!userId) return;
      stopAuthWatch?.();
      stopAuthWatch = null;
      void store.initialize();
    };
    onMounted(() => {
      const userId = authStore.getUserData()?.id;
      if (userId) {
        initializeForUser(userId);
        return;
      }
      stopAuthWatch = watch(
        () => authStore.getUserData()?.id,
        (nextUserId) => initializeForUser(nextUserId),
      );
    });
    onUnmounted(() => stopAuthWatch?.());
  }

  return {
    isSupported: readonly(notificationSupported),
    permission: readonly(permission),
    isEnabled: readonly(isEnabled),
    requestPermission: store.requestPermission,
    showNotification: store.showNotification,
    showMessageNotification: store.showMessageNotification,
    shouldShowNotification: store.shouldShowNotification,
    setEnabled: store.setEnabled,
  };
}
