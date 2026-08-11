export function usePushSubscription() {
  const store = useNotificationsStore();
  const { pushSupported, subscription, isSubscribed, loading, error } =
    storeToRefs(store);

  return {
    isSupported: readonly(pushSupported),
    subscription: readonly(subscription),
    isSubscribed: readonly(isSubscribed),
    loading: readonly(loading),
    error: readonly(error),
    subscribe: store.subscribe,
    unsubscribe: store.unsubscribe,
    updateSubscription: store.updateSubscription,
    getExistingSubscription: store.getExistingSubscription,
  };
}
