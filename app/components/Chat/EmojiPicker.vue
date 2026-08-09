<template>
  <div
    class="emoji-picker flex max-h-[min(400px,calc(100dvh-2rem))] w-[min(320px,calc(100vw-2rem))] flex-col border border-base-300 bg-base-100"
  >
    <div class="p-2 border-b border-base-300">
      <input
        v-model="searchQuery"
        type="text"
        aria-label="Search emojis"
        placeholder="Search emojis..."
        class="metro-input min-h-11 w-full"
        autocomplete="off"
      />
    </div>

    <div v-if="!searchQuery" class="px-2 py-1.5 border-b border-base-300">
      <div class="grid grid-cols-5 gap-1 min-[352px]:grid-cols-6">
        <button
          v-for="emoji in QUICK_REACTIONS"
          :key="emoji"
          class="metro-icon-btn metro-icon-btn--ghost min-h-11 min-w-11 text-lg hover:bg-base-300"
          @click="$emit('select', emoji)"
          :aria-label="'Add reaction ' + emoji"
        >
          {{ emoji }}
        </button>
      </div>
    </div>

    <div
      v-if="!searchQuery"
      class="grid grid-cols-5 gap-1 border-b border-base-300 px-2 py-1 min-[352px]:grid-cols-6"
    >
      <button
        v-for="cat in categories"
        :key="cat.id"
        class="metro-icon-btn metro-icon-btn--ghost min-h-11 min-w-11"
        :class="{ 'bg-base-300': activeCategory === cat.id }"
        @click="activeCategory = cat.id"
        :aria-label="cat.name"
        :title="cat.name"
      >
        <Icon :name="cat.icon" class="h-4 w-4" />
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-2">
      <div v-if="searchQuery">
        <div
          v-if="searchResults.length === 0"
          class="text-center text-base-content/40 py-6 text-sm"
        >
          No emojis found
        </div>
        <div class="grid grid-cols-5 gap-1 min-[352px]:grid-cols-6">
          <button
            v-for="item in searchResults"
            :key="item.emoji"
            class="metro-icon-btn metro-icon-btn--ghost min-h-11 min-w-11 text-lg hover:bg-base-300"
            @click="selectEmoji(item)"
            :aria-label="item.name"
          >
            {{ item.emoji }}
          </button>
        </div>
      </div>

      <div v-else>
        <div
          v-for="cat in categories"
          :key="cat.id"
          v-show="cat.id === activeCategory"
        >
          <div
            v-if="cat.id === 'recent' && cat.emojis.length === 0"
            class="text-center text-base-content/40 py-6 text-sm"
          >
            No recently used emojis
          </div>
          <div class="grid grid-cols-5 gap-1 min-[352px]:grid-cols-6">
            <button
              v-for="item in cat.emojis"
              :key="item.emoji"
              class="metro-icon-btn metro-icon-btn--ghost min-h-11 min-w-11 text-lg hover:bg-base-300"
              @click="selectEmoji(item)"
              :aria-label="item.name"
            >
              {{ item.emoji }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  EMOJI_CATEGORIES,
  QUICK_REACTIONS,
  searchEmojis,
  getRecentEmojis,
  addRecentEmoji,
} from "../../shared/emoji-data";

const emit = defineEmits(["select"]);

const searchQuery = ref("");
const activeCategory = ref("smileys");
const categories = ref([]);

onMounted(() => {
  categories.value = EMOJI_CATEGORIES.map((cat) => {
    if (cat.id === "recent") {
      return { ...cat, emojis: getRecentEmojis() };
    }
    return { ...cat };
  });
});

const searchResults = computed(() => {
  return searchEmojis(searchQuery.value);
});

function selectEmoji(item) {
  addRecentEmoji(item.emoji);
  emit("select", item.emoji);
}
</script>
