<template>
  <div class="smpte-bars relative flex h-full min-h-0 w-full flex-col bg-black">
    <div class="grid min-h-0 flex-1 grid-cols-7">
      <span
        v-for="(bar, index) in upperBars"
        :key="`${bar.name}-${index}`"
        :style="{ backgroundColor: bar.color }"
        :aria-label="bar.name"
      ></span>
    </div>
    <div class="grid h-[15%] grid-cols-7">
      <span
        v-for="(bar, index) in lowerBars"
        :key="`${bar.name}-${index}`"
        :style="{ backgroundColor: bar.color }"
        :aria-label="bar.name"
      ></span>
    </div>
    <div
      class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-black/80 px-4 py-3 text-sm font-semibold text-white"
    >
      <span class="truncate">{{ label }}</span>
      <span
        class="shrink-0 font-mono text-xs uppercase tracking-[0.18em] text-white/70"
        >No signal</span
      >
    </div>
  </div>
</template>

<script setup>
defineProps({
  label: {
    type: String,
    required: true,
  },
});

const upperBars = [
  { name: "White", color: "#c0c0c0" },
  { name: "Yellow", color: "#c0c000" },
  { name: "Cyan", color: "#00c0c0" },
  { name: "Green", color: "#00c000" },
  { name: "Magenta", color: "#c000c0" },
  { name: "Red", color: "#c00000" },
  { name: "Blue", color: "#0000c0" },
];
const lowerBars = [
  { name: "Blue", color: "#0000c0" },
  { name: "Black", color: "#101010" },
  { name: "Magenta", color: "#c000c0" },
  { name: "Black", color: "#101010" },
  { name: "Cyan", color: "#00c0c0" },
  { name: "Black", color: "#101010" },
  { name: "White", color: "#c0c0c0" },
];
</script>
