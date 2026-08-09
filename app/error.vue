<template>
  <section
    class="metro-standalone flex min-h-screen items-center bg-base-100 px-6 py-12 sm:px-12"
    role="alert"
  >
    <div class="w-full max-w-3xl">
      <Icon
        :name="invalidLink ? 'lucide:link-2-off' : 'lucide:triangle-alert'"
        class="mb-8 size-12"
        :class="invalidLink ? 'text-error' : 'text-hero'"
        aria-hidden="true"
      />
      <p
        class="mb-3 text-sm font-semibold"
        :class="invalidLink ? 'text-error' : 'text-hero'"
      >
        {{ invalidLink ? "Unable to open this page" : "dSpeak" }}
      </p>
      <h1 class="metro-title">
        {{ invalidLink ? "Invalid link" : "Something went wrong" }}
      </h1>
      <p class="mt-5 max-w-xl text-base text-base-content/70 sm:text-lg">
        {{ message }}
      </p>
      <button class="metro-btn mt-10" @click="returnToWorkspace">
        Back to your workspace
      </button>
    </div>
  </section>
</template>

<script setup>
const props = defineProps({
  error: {
    type: Object,
    required: true,
  },
});

const statusCode = computed(() =>
  Number(props.error?.statusCode || props.error?.status || 500),
);
const invalidLink = computed(
  () => statusCode.value === 403 || statusCode.value === 404,
);
const message = computed(() => {
  if (invalidLink.value) {
    return (
      props.error?.message ||
      "This link is invalid, or your account does not have permission to open it."
    );
  }
  return "dSpeak could not finish opening this page. Return to your workspace and try again.";
});

async function returnToWorkspace() {
  await clearError({ redirect: "/" });
}
</script>
