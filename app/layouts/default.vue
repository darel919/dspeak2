<template>
  <Init v-slot="{ authenticated }">
    <div v-if="authenticated" class="authenticated-shell">
      <MetroRoomRail />
      <Navbar />
      <main class="pt-[var(--navbar-height)] md:pl-[72px]">
        <slot />
      </main>
    </div>
    <slot v-else />
    <ToastContainer />
  </Init>
</template>

<script setup>
import ToastContainer from "../components/ToastContainer.vue";
</script>
