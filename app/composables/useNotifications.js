export function useNotifications() {
  const store = useNotificationsStore()
  const { notificationSupported, permission, isEnabled } = storeToRefs(store)

  if (import.meta.client) onMounted(() => store.initialize())

  return {
    isSupported: readonly(notificationSupported),
    permission: readonly(permission),
    isEnabled: readonly(isEnabled),
    requestPermission: store.requestPermission,
    showNotification: store.showNotification,
    showMessageNotification: store.showMessageNotification,
    shouldShowNotification: store.shouldShowNotification,
    setEnabled: store.setEnabled,
  }
}
