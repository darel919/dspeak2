export interface VoicePageLifecycleOptions {
  getChannelId: () => string | null;
  leaveChannel: (channelId: string) => void;
}

export function createVoicePageLifecycle({
  getChannelId,
  leaveChannel,
}: VoicePageLifecycleOptions) {
  let removePageHideListener: (() => void) | null = null;

  function register() {
    if (!import.meta.client || removePageHideListener) return;
    const handlePageHide = () => {
      const channelId = getChannelId();
      if (!channelId) return;
      Promise.resolve(leaveChannel(channelId)).catch(() => {});
    };
    window.addEventListener("pagehide", handlePageHide);
    removePageHideListener = () =>
      window.removeEventListener("pagehide", handlePageHide);
  }

  function unregister() {
    if (!removePageHideListener) return;
    removePageHideListener();
    removePageHideListener = null;
  }

  return { register, unregister };
}
