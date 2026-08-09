<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-[1000] flex min-h-screen items-center justify-center bg-[#09091b]/70 px-6 py-8"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    <section
      class="w-full max-w-[380px] rounded-2xl border border-white/20 bg-[#292a2e] px-7 py-8 text-center text-white shadow-2xl"
      aria-labelledby="startup-loader-title"
    >
      <img :src="startupLogo" alt="" class="mx-auto size-16 object-contain" />
      <p
        class="mt-5 text-xs font-semibold uppercase tracking-[0.24em] text-white/55"
      >
        dSpeak
      </p>
      <h1
        id="startup-loader-title"
        class="mt-3 text-xl font-semibold tracking-tight"
      >
        {{ status }}
      </h1>
      <div
        v-if="progress !== null"
        class="mx-auto mt-8 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/15"
        role="progressbar"
        :aria-valuenow="progress"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="progressLabel"
      >
        <div
          class="h-full rounded-full bg-white transition-[width] duration-300"
          :style="{ width: `${progress}%` }"
        ></div>
      </div>
    </section>
  </div>
</template>

<script setup>
import startupLogo from "../assets/logo/logo_96.png";

defineProps({
  visible: {
    type: Boolean,
    default: true,
  },
  status: {
    type: String,
    default: "Preparing dSpeak…",
  },
  progress: {
    type: Number,
    default: null,
  },
  progressLabel: {
    type: String,
    default: "Startup progress",
  },
});
</script>
