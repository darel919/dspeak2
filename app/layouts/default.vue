<template>
  <Init v-slot="{ authenticated }">
    <Navbar v-if="authenticated" />
    <main v-if="authenticated" class="pt-[var(--navbar-height)]">
      <slot />
    </main>
    <slot v-else />
    <ToastContainer />
  </Init>
</template>

<script setup>
import ToastContainer from '../components/ToastContainer.vue'
</script>
