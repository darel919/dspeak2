<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed bottom-0 left-0 right-0 z-50 border-t border-base-300 bg-base-200 p-4 shadow-lg"
      role="alert"
      aria-label="Cookie notice"
    >
      <div
        class="mx-auto flex max-w-4xl flex-col items-start gap-3 sm:flex-row sm:items-center"
      >
        <p class="flex-1 text-sm leading-relaxed">
          dSpeak uses a session cookie to keep you signed in. This cookie is
          strictly necessary for the application to function. No tracking or
          analytics cookies are used.
          <NuxtLink class="link link-primary whitespace-nowrap" to="/privacy"
            >Learn more</NuxtLink
          >.
        </p>
        <button
          class="btn btn-primary btn-sm shrink-0"
          type="button"
          @click="dismiss"
        >
          Got it
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
const CONSENT_KEY = "dspeak_cookie_consent";
const visible = ref(false);

function dismiss() {
  visible.value = false;
  try {
    localStorage.setItem(CONSENT_KEY, "true");
  } catch {}
}

onMounted(() => {
  try {
    if (localStorage.getItem(CONSENT_KEY) !== "true") {
      visible.value = true;
    }
  } catch {
    visible.value = true;
  }
});
</script>
