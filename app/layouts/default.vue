<template>
  <Init v-slot="{ authenticated }">
    <Navbar v-if="authenticated" />
    <slot />
    <ToastContainer />
  </Init>
</template>

<script setup>
import ToastContainer from '../components/ToastContainer.vue'
</script>
