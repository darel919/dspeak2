<template>
  <div
    class="metro-standalone flex min-h-screen items-center justify-center bg-base-100 px-6"
  >
    <div class="w-full max-w-lg">
      <template v-if="status === 'working'">
        <div class="metro-spinner loading-lg text-primary"></div>
        <h1 class="mt-5 text-2xl font-semibold">Authenticating…</h1>
        <p class="mt-2 text-base-content/65">
          Verifying your account and preparing your dSpeak session.
        </p>
      </template>
      <template v-else-if="status === 'waiting'">
        <p class="text-sm font-semibold text-primary">Waiting for browser</p>
        <h1 class="mt-2 text-2xl font-semibold">
          Complete sign-in in your browser
        </h1>
        <p class="mt-3 text-base-content/70" role="status" aria-live="polite">
          Return here after authentication. If the browser tab was closed, you
          can open it again.
        </p>
        <div class="mt-6 flex flex-wrap gap-3">
          <button class="metro-btn" type="button" @click="checkSignIn">
            I've finished signing in
          </button>
          <button
            class="metro-btn metro-btn--ghost"
            type="button"
            @click="reopenBrowser"
          >
            Open browser again
          </button>
          <button
            class="metro-btn metro-btn--ghost"
            type="button"
            @click="cancelSignIn"
          >
            Cancel
          </button>
        </div>
      </template>
      <template v-else-if="showTerms">
        <p class="text-sm font-semibold text-primary">Welcome to dSpeak</p>
        <h1 class="mt-2 text-2xl font-semibold">Before you sign in</h1>
        <p class="mt-3 text-base-content/70">
          Please review and accept the Terms of Service and Privacy Policy to
          continue.
        </p>
        <div class="mt-4">
          <label class="flex cursor-pointer items-start gap-3">
            <input
              v-model="termsAccepted"
              class="metro-checkbox mt-0.5"
              type="checkbox"
            />
            <span class="text-sm leading-relaxed">
              I have read and agree to the
              <a
                class="metro-link"
                :href="termsUrl"
                target="_blank"
                rel="noopener noreferrer"
                @click.prevent="openLegalUrl('/terms')"
              >
                Terms of Service
              </a>
              and
              <a
                class="metro-link"
                :href="privacyUrl"
                target="_blank"
                rel="noopener noreferrer"
                @click.prevent="openLegalUrl('/privacy')"
              >
                Privacy Policy </a
              >.
            </span>
          </label>
        </div>
        <div class="mt-6 flex flex-wrap gap-3">
          <button
            class="metro-btn"
            type="button"
            :disabled="!termsAccepted"
            @click="startSignIn"
          >
            Sign in
          </button>
          <NuxtLink class="metro-btn metro-btn--ghost" to="/"
            >Return home</NuxtLink
          >
        </div>
      </template>
      <template v-else>
        <p class="text-sm font-semibold text-error">Sign-in interrupted</p>
        <h1 class="mt-2 text-2xl font-semibold">
          We couldn't complete authentication
        </h1>
        <p class="mt-3 text-base-content/70">{{ failureMessage }}</p>
        <div
          v-if="failureDiagnostic"
          class="mt-4 rounded-lg bg-base-200 p-3 font-mono text-xs text-base-content/75"
        >
          <p>Code: {{ failureDiagnostic.code }}</p>
          <p>Stage: {{ failureDiagnostic.stage }}</p>
          <p v-if="failureDiagnostic.httpStatus">
            HTTP {{ failureDiagnostic.httpStatus }}
          </p>
          <p v-else>HTTP: no response</p>
          <p v-if="failureDiagnostic.transport">
            Transport: {{ failureDiagnostic.transport }}
          </p>
          <p v-if="failureDiagnostic.requestId">
            Request ID: {{ failureDiagnostic.requestId }}
          </p>
          <p v-if="failureDiagnostic.requestUrl">
            Request: {{ failureDiagnostic.requestUrl }}
          </p>
          <p v-if="failureDiagnostic.responseUrl">
            Response: {{ failureDiagnostic.responseUrl }}
          </p>
          <p v-if="failureDiagnostic.redirected !== undefined">
            Redirected: {{ failureDiagnostic.redirected ? "yes" : "no" }}
          </p>
          <p v-if="failureDiagnostic.statusText">
            Response status text: {{ failureDiagnostic.statusText }}
          </p>
          <p v-if="failureDiagnostic.retryAfter">
            Retry-After: {{ failureDiagnostic.retryAfter }}
          </p>
          <p v-if="failureDiagnostic.serverHeader">
            Server: {{ failureDiagnostic.serverHeader }}
          </p>
          <p v-if="failureDiagnostic.viaHeader">
            Via: {{ failureDiagnostic.viaHeader }}
          </p>
          <p v-if="failureDiagnostic.vercelRequestId">
            Vercel ID: {{ failureDiagnostic.vercelRequestId }}
          </p>
          <p v-if="failureDiagnostic.cloudflareRay">
            CF-Ray: {{ failureDiagnostic.cloudflareRay }}
          </p>
          <p v-if="failureDiagnostic.serverBuildCommit">
            Server {{ failureDiagnostic.serverBuildCommit }}
          </p>
          <p v-if="failureDiagnostic.clientBuildCommit">
            Client {{ failureDiagnostic.clientBuildCommit }}
          </p>
          <p v-if="failureDiagnostic.serverProjectRef">
            Server project {{ failureDiagnostic.serverProjectRef }}
          </p>
          <p v-if="failureDiagnostic.clientProjectRef">
            Client project {{ failureDiagnostic.clientProjectRef }}
          </p>
        </div>
        <div class="mt-6 flex flex-wrap gap-3">
          <button class="metro-btn" type="button" @click="copyDiagnostics">
            Copy diagnostics
          </button>
          <button class="metro-btn" type="button" @click="showTerms = true">
            Try sign-in again
          </button>
          <NuxtLink class="metro-btn metro-btn--ghost" to="/"
            >Return home</NuxtLink
          >
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { useAuthStore } from "../stores/auth";
import { useRoomsStore } from "../stores/rooms";
import { useRuntimeStore } from "../stores/runtime";
import { hasTauriRuntimeMarker } from "../shared/desktop-capture.ts";
import { mapFailureDiagnostic } from "../shared/desktop-session-diagnostics.ts";
import {
  buildPublicUrl,
  openExternalUrl,
} from "../shared/desktop-external-url.ts";

const authStore = useAuthStore();
const roomsStore = useRoomsStore();
const runtimeStore = useRuntimeStore();
const runtimeConfig = useRuntimeConfig();
const router = useRouter();
const route = useRoute();
const desktopRuntime = computed(
  () => runtimeStore.isTauri || hasTauriRuntimeMarker(),
);
const status = ref("working");
const showTerms = ref(false);
const termsAccepted = ref(false);
const failureMessage = ref("");
const failureDiagnostic = ref(null);
let completionPromise = null;

let loginUrl = "";
let signInTimeout;
let signInPoll;
let signInCheckInFlight = false;

const termsUrl = computed(() =>
  desktopRuntime.value
    ? buildPublicUrl(runtimeConfig.public.publicOrigin, "/terms")
    : "/terms",
);
const privacyUrl = computed(() =>
  desktopRuntime.value
    ? buildPublicUrl(runtimeConfig.public.publicOrigin, "/privacy")
    : "/privacy",
);

function clearSignInTimeout() {
  if (!signInTimeout) return;
  clearTimeout(signInTimeout);
  signInTimeout = undefined;
}

function clearSignInPolling() {
  if (!signInPoll) return;
  clearInterval(signInPoll);
  signInPoll = undefined;
}

function startSignInPolling() {
  clearSignInPolling();
  signInPoll = setInterval(() => void checkSignIn(false), 1000);
}

function startSignInTimeout() {
  clearSignInTimeout();
  signInTimeout = setTimeout(() => {
    if (status.value !== "waiting") return;
    clearSignInPolling();
    authStore.cancelDesktopSignIn();
    status.value = "failed";
    failureMessage.value =
      "Sign-in was not completed. The browser may have been closed. Try again when you're ready.";
  }, 180_000);
}

function readStorage(key) {
  try {
    return sessionStorage.getItem(key);
  } catch (error) {
    console.warn(`[Auth] Could not read ${key}:`, error);
    return null;
  }
}

function removeStorage(key) {
  try {
    sessionStorage.removeItem(key);
  } catch (error) {
    console.warn(`[Auth] Could not remove ${key}:`, error);
  }
}

function internalRedirect(value) {
  if (!value) return "/";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function signInFailureMessage(error, fallback) {
  const code = error?.code || error?.name;
  const mapped = mapFailureDiagnostic(error);
  if (mapped) failureDiagnostic.value = mapped;
  if (code === "DESKTOP_OAUTH_BROWSER_OPEN_FAILED")
    return "dSpeak could not open your browser. Please try again.";
  if (code === "DESKTOP_OAUTH_CALLBACK_SERVER_UNAVAILABLE")
    return "Could not start sign-in. Please try again.";
  if (
    code === "DESKTOP_OAUTH_URL_GENERATION_FAILED" ||
    code === "DESKTOP_OAUTH_PROVIDER_REJECTED" ||
    code === "DESKTOP_OAUTH_STATE_MISMATCH"
  )
    return "Could not start sign-in. Please try again.";
  if (code === "DESKTOP_OAUTH_CODE_EXCHANGE_FAILED")
    return "Authentication completed, but dSpeak could not verify the sign-in.";
  if (
    code === "DESKTOP_API_SESSION_BRIDGE_FAILED" ||
    code === "DESKTOP_API_SESSION_RESTORE_FAILED" ||
    code === "DESKTOP_SESSION_PAYLOAD_INVALID"
  )
    return "Your Google sign-in succeeded, but dSpeak could not create your app session.";
  return fallback;
}

function copyDiagnostics() {
  const diag = failureDiagnostic.value;
  if (!diag) return;

  const lines = [
    `Code: ${diag.code}`,
    `Stage: ${diag.stage}`,
    diag.httpStatus !== null && diag.httpStatus !== undefined
      ? `HTTP: ${diag.httpStatus}`
      : "HTTP: no response",
    diag.transport ? `Transport: ${diag.transport}` : "",
    diag.requestId ? `Request ID: ${diag.requestId}` : "",
    diag.requestUrl ? `Request URL: ${diag.requestUrl}` : "",
    diag.responseUrl ? `Response URL: ${diag.responseUrl}` : "",
    diag.redirected !== undefined
      ? `Redirected: ${diag.redirected ? "yes" : "no"}`
      : "",
    diag.statusText ? `Response status text: ${diag.statusText}` : "",
    diag.retryAfter ? `Retry-After: ${diag.retryAfter}` : "",
    diag.serverHeader ? `Server: ${diag.serverHeader}` : "",
    diag.viaHeader ? `Via: ${diag.viaHeader}` : "",
    diag.vercelRequestId ? `Vercel ID: ${diag.vercelRequestId}` : "",
    diag.cloudflareRay ? `CF-Ray: ${diag.cloudflareRay}` : "",
    diag.serverBuildCommit ? `Server build: ${diag.serverBuildCommit}` : "",
    diag.clientBuildCommit ? `Client build: ${diag.clientBuildCommit}` : "",
    diag.serverProjectRef ? `Server project: ${diag.serverProjectRef}` : "",
    diag.clientProjectRef ? `Client project: ${diag.clientProjectRef}` : "",
  ].filter(Boolean);

  navigator.clipboard.writeText(lines.join("\n")).catch((err) => {
    console.error("[Auth] Failed to copy diagnostics:", err);
  });
}

async function openLegalUrl(path) {
  const url = desktopRuntime.value
    ? buildPublicUrl(runtimeConfig.public.publicOrigin, path)
    : new URL(path, window.location.origin).toString();
  try {
    await openExternalUrl(url, desktopRuntime.value);
  } catch (error) {
    console.error("[Auth] Could not open legal URL:", error);
  }
}

async function startSignIn() {
  status.value = "working";
  showTerms.value = false;
  failureMessage.value = "";
  failureDiagnostic.value = null;
  try {
    const result = await authStore.beginExternalSignIn(termsAccepted.value);
    if (result.isDesktop) {
      loginUrl = result.loginUrl;
      status.value = "waiting";
      startSignInTimeout();
      startSignInPolling();
    }
  } catch (error) {
    console.error("[Auth] Could not start sign-in:", error);
    status.value = "failed";
    failureMessage.value = signInFailureMessage(
      error,
      "The authentication service is unavailable. Please try again.",
    );
  }
}

async function reopenBrowser() {
  if (!loginUrl) return;
  try {
    await openExternalUrl(loginUrl, true);
    startSignInTimeout();
  } catch (error) {
    console.error("[Auth] DESKTOP_OAUTH_BROWSER_OPEN_FAILED:", error);
    status.value = "failed";
    failureMessage.value = signInFailureMessage(
      error,
      "dSpeak could not open your browser. Please try again.",
    );
  }
}

async function checkSignIn(manual = true) {
  if (status.value !== "waiting") return;
  if (signInCheckInFlight) return;
  signInCheckInFlight = true;
  if (manual) status.value = "working";
  try {
    const completed =
      authStore.getUserData()?.id ||
      (await authStore.completePendingDesktopSignIn()) ||
      (manual && (await authStore.restoreSession()));
    if (completed) {
      clearSignInTimeout();
      clearSignInPolling();
      await finishAuthentication();
      return;
    }
    if (manual) status.value = "waiting";
  } catch (error) {
    if (!manual) {
      console.warn("[Auth] Automatic desktop sign-in check failed:", error);
      clearSignInPolling();
      status.value = "failed";
      failureMessage.value = signInFailureMessage(
        error,
        "The completed browser sign-in could not be transferred to dSpeak. Start sign-in again.",
      );
      return;
    }
    console.error("[Auth] Could not complete desktop sign-in:", error);
    clearSignInPolling();
    status.value = "failed";
    failureMessage.value = signInFailureMessage(
      error,
      "The completed browser sign-in could not be transferred to dSpeak. Start sign-in again.",
    );
  } finally {
    signInCheckInFlight = false;
  }
}

function cancelSignIn() {
  clearSignInTimeout();
  clearSignInPolling();
  authStore.cancelDesktopSignIn();
  loginUrl = "";
  status.value = "idle";
  showTerms.value = true;
}

async function finishAuthentication() {
  if (completionPromise) return completionPromise;
  if (!authStore.getUserData()?.id) return false;
  completionPromise = (async () => {
    try {
      await roomsStore.fetchRooms();
      const redirectUrl = readStorage("redirectAfterAuth");
      if (redirectUrl) removeStorage("redirectAfterAuth");
      await router.replace(internalRedirect(redirectUrl));
      return true;
    } catch {
      completionPromise = null;
      status.value = "failed";
      failureMessage.value =
        "Your session is ready, but dSpeak could not open the requested page. Please try again.";
      return false;
    }
  })();
  return completionPromise;
}

onMounted(async () => {
  await runtimeStore.initialize();
  const callbackCode = String(route.query.code || "");
  if (callbackCode) {
    try {
      const completed = await authStore.completeWebSignIn(callbackCode);
      if (!completed) throw new Error("Session restoration failed");
      await finishAuthentication();
      return;
    } catch (error) {
      console.error("[Auth] Could not complete web sign-in:", error);
      status.value = "failed";
      failureMessage.value =
        "The completed browser sign-in could not be transferred to dSpeak. Start sign-in again.";
      return;
    }
  }
  if (await finishAuthentication()) return;

  if (await authStore.restoreSession()) {
    await finishAuthentication();
    return;
  }

  if (runtimeStore.isTauri && authStore.hasPendingDesktopOAuthAttempt()) {
    status.value = "waiting";
    startSignInTimeout();
    startSignInPolling();
    return;
  }

  await authStore.clearAuth(false);
  status.value = "idle";
  showTerms.value = true;
});

onUnmounted(() => {
  clearSignInTimeout();
  clearSignInPolling();
});
</script>
