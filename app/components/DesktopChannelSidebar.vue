<template>
  <aside
    class="desktop-channel-sidebar relative hidden shrink-0 border-r border-base-300 md:block"
    :style="{ '--desktop-channel-sidebar-width': `${width}px` }"
  >
    <div class="h-full min-h-0 overflow-hidden">
      <slot />
    </div>
    <div
      class="sidebar-resize-handle"
      :class="{ 'sidebar-resize-handle-active': resizing }"
      role="separator"
      aria-label="Resize channel sidebar"
      aria-orientation="vertical"
      :aria-valuemin="DESKTOP_SIDEBAR_MIN_WIDTH"
      :aria-valuemax="DESKTOP_SIDEBAR_MAX_WIDTH"
      :aria-valuenow="width"
      tabindex="0"
      @dblclick="resetWidth"
      @keydown="onHandleKeydown"
      @pointerdown="startResize"
    />
  </aside>
</template>

<script setup>
import {
  clampDesktopSidebarWidth,
  DESKTOP_SIDEBAR_DEFAULT_WIDTH,
  DESKTOP_SIDEBAR_KEYBOARD_STEP,
  DESKTOP_SIDEBAR_MAX_WIDTH,
  DESKTOP_SIDEBAR_MIN_WIDTH,
} from "../shared/desktop-sidebar-layout";

const STORAGE_KEY = "dspeak.desktopChannelSidebarWidth";

const width = ref(DESKTOP_SIDEBAR_DEFAULT_WIDTH);
const resizing = ref(false);
let dragStartX = 0;
let dragStartWidth = DESKTOP_SIDEBAR_DEFAULT_WIDTH;
let previousCursor = "";
let previousUserSelect = "";

function persistWidth() {
  try {
    localStorage.setItem(STORAGE_KEY, String(width.value));
  } catch (error) {
    console.warn("Could not save the channel sidebar width", error);
  }
}

function setWidth(nextWidth, persist = true) {
  width.value = clampDesktopSidebarWidth(nextWidth);
  if (persist) persistWidth();
}

function restoreDocumentInteraction() {
  if (!import.meta.client) return;
  document.body.style.cursor = previousCursor;
  document.body.style.userSelect = previousUserSelect;
}

function finishResize() {
  if (!resizing.value) return;
  resizing.value = false;
  window.removeEventListener("pointermove", resizeFromPointer);
  window.removeEventListener("pointerup", finishResize);
  window.removeEventListener("pointercancel", finishResize);
  restoreDocumentInteraction();
  persistWidth();
}

function resizeFromPointer(event) {
  setWidth(dragStartWidth + event.clientX - dragStartX, false);
}

function startResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  dragStartX = event.clientX;
  dragStartWidth = width.value;
  resizing.value = true;
  previousCursor = document.body.style.cursor;
  previousUserSelect = document.body.style.userSelect;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", resizeFromPointer);
  window.addEventListener("pointerup", finishResize);
  window.addEventListener("pointercancel", finishResize);
}

function resetWidth() {
  setWidth(DESKTOP_SIDEBAR_DEFAULT_WIDTH);
}

function onHandleKeydown(event) {
  let nextWidth;
  if (event.key === "ArrowLeft") {
    nextWidth = width.value - DESKTOP_SIDEBAR_KEYBOARD_STEP;
  } else if (event.key === "ArrowRight") {
    nextWidth = width.value + DESKTOP_SIDEBAR_KEYBOARD_STEP;
  } else if (event.key === "Home") {
    nextWidth = DESKTOP_SIDEBAR_MIN_WIDTH;
  } else if (event.key === "End") {
    nextWidth = DESKTOP_SIDEBAR_MAX_WIDTH;
  } else {
    return;
  }
  event.preventDefault();
  setWidth(nextWidth);
}

onMounted(() => {
  try {
    const storedWidth = localStorage.getItem(STORAGE_KEY);
    if (storedWidth !== null) setWidth(storedWidth, false);
  } catch (error) {
    console.warn("Could not restore the channel sidebar width", error);
  }
});

onUnmounted(() => {
  finishResize();
});
</script>

<style scoped>
.desktop-channel-sidebar {
  width: min(var(--desktop-channel-sidebar-width), 32vw);
  min-width: 15rem;
  max-width: 30rem;
}

.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: -0.25rem;
  bottom: 0;
  z-index: 20;
  width: 0.5rem;
  cursor: col-resize;
  touch-action: none;
}

.sidebar-resize-handle::after {
  position: absolute;
  top: 0;
  right: 0.1875rem;
  bottom: 0;
  width: 0.125rem;
  content: "";
  background: transparent;
}

.sidebar-resize-handle:hover::after,
.sidebar-resize-handle:focus-visible::after,
.sidebar-resize-handle-active::after {
  background: color-mix(in oklab, var(--color-primary) 75%, transparent);
}

.sidebar-resize-handle:focus-visible {
  outline: 0.125rem solid var(--color-primary);
  outline-offset: -0.125rem;
}

@media (forced-colors: active) {
  .sidebar-resize-handle:hover::after,
  .sidebar-resize-handle:focus-visible::after,
  .sidebar-resize-handle-active::after {
    background: Highlight;
  }
}
</style>
