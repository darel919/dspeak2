<template>
  <div class="min-h-screen max-w-lg mx-auto pt-20 px-6">
    <h1 class="text-2xl font-bold mb-6">Settings</h1>
    <section class="mb-8">
      <h2 class="text-lg font-semibold mb-3">Notification Settings</h2>
      <NotificationSettings />
    </section>
    <!-- Add more settings sections here as needed -->
  </div>
</template>

<script setup>
import NotificationSettings from '../components/NotificationSettings.vue'
</script>
