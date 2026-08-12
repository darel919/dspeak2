import { watch } from "vue";
import type { Ref } from "vue";

export function registerEchoWarning(echoDetected: Ref<boolean>) {
  watch(echoDetected, (detected) => {
    if (!detected) return;
    import("~/composables/useToast").then(({ useToast }) => {
      useToast().warning(
        "Others may hear an echo from you. Try enabling echo cancellation in your audio settings.",
        8000,
      );
    });
  });
}
