import { isFatalClientError } from "~/shared/fatal-client-error.js";

export default defineNuxtPlugin(() => {
  const { report } = useFatalClientError();

  function handleError(event) {
    const error = event.error || event.reason || event.message;
    if (isFatalClientError(error)) report(error);
  }

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleError);
});
