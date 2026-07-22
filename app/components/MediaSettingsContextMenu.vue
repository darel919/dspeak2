<template>
  <span class="contents" @contextmenu.prevent.stop="openMenu">
    <slot />
  </span>

  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuElement"
      class="fixed z-[1200] min-w-52 rounded-xl border border-base-300 bg-base-100 p-1.5 text-base-content shadow-2xl"
      :style="menuStyle"
      role="menu"
      :aria-label="`${label} options`"
      @pointerdown.stop
      @contextmenu.prevent.stop
    >
      <NuxtLink
        class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-none"
        :to="settingsLink"
        role="menuitem"
        @click="closeMenu"
      >
        <Icon :name="icon" class="size-4" />
        <span>Open {{ label.toLowerCase() }} settings</span>
        <Icon name="lucide:settings" class="ml-auto size-4 opacity-55" />
      </NuxtLink>
    </div>
  </Teleport>
</template>

<script setup>
const props = defineProps({
  kind: {
    type: String,
    required: true,
    validator: (value) => ["microphone", "camera"].includes(value),
  },
});

const visible = ref(false);
const menuElement = ref(null);
const position = ref({ x: 0, y: 0 });
const viewportPadding = 8;

const label = computed(() =>
  props.kind === "microphone" ? "Microphone" : "Camera",
);
const icon = computed(() =>
  props.kind === "microphone" ? "lucide:mic" : "lucide:video",
);
const settingsLink = computed(() => ({
  path: "/settings",
  query: { section: "voice" },
  hash: `#${props.kind}-settings`,
}));
const menuStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
}));

async function openMenu(event) {
  position.value = { x: event.clientX, y: event.clientY };
  visible.value = true;
  await nextTick();
  keepInViewport();
  menuElement.value?.querySelector('[role="menuitem"]')?.focus();
}

function keepInViewport() {
  if (!menuElement.value) return;
  const bounds = menuElement.value.getBoundingClientRect();
  position.value = {
    x: Math.max(
      viewportPadding,
      Math.min(
        position.value.x,
        window.innerWidth - bounds.width - viewportPadding,
      ),
    ),
    y: Math.max(
      viewportPadding,
      Math.min(
        position.value.y,
        window.innerHeight - bounds.height - viewportPadding,
      ),
    ),
  };
}

function closeMenu() {
  visible.value = false;
}

function onKeydown(event) {
  if (event.key === "Escape") closeMenu();
}

onMounted(() => {
  document.addEventListener("pointerdown", closeMenu);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", closeMenu);
  window.addEventListener("scroll", closeMenu, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeMenu);
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", closeMenu);
  window.removeEventListener("scroll", closeMenu, true);
});
</script>
