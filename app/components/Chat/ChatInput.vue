<template>
  <ImageUploadArea
    ref="uploadArea"
    :channel-id="channelId"
    @images-added="onImagesAdded"
  >
    <template #default="{ openFilePicker, pendingImages: uploadPendingImages }">
      <div class="bg-base-100 border-t border-base-200 p-4">
        <div
          v-if="replyingTo"
          class="flex items-center gap-2 px-3 py-1.5 mb-2 bg-base-200 rounded-lg text-sm"
        >
          <Icon
            name="lucide:corner-down-right"
            class="h-4 w-4 text-base-content/40"
          />
          <span class="text-base-content/60">Replying to</span>
          <span class="font-semibold truncate flex-1">{{
            getReplyPreview()
          }}</span>
          <button
            class="metro-btn metro-btn--ghost btn-xs btn-square"
            aria-label="Cancel reply"
            @click="$emit('cancel-reply')"
          >
            <Icon name="lucide:x" class="h-3 w-3" />
          </button>
        </div>

        <div
          v-if="pendingImages.length > 0"
          class="mb-3 bg-base-200 p-3"
          role="list"
          aria-label="Image previews"
        >
          <div class="mb-2 flex items-center justify-between gap-3">
            <span class="text-sm font-semibold">Ready to attach</span>
            <span class="text-xs text-base-content/65">
              {{ pendingImages.length }}/4 images
            </span>
          </div>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="(img, index) in pendingImages"
              :key="index"
              class="group relative border border-base-300 bg-base-100 p-1"
              role="listitem"
            >
              <img
                :src="img.previewUrl"
                :alt="img.file.name"
                class="h-20 w-20 object-contain"
              />
              <button
                type="button"
                class="metro-btn metro-btn--error btn-sm btn-square absolute right-1 top-1 h-8 min-h-8 opacity-90"
                aria-label="Remove image"
                @click="removeImage(index)"
              >
                <Icon name="lucide:x" class="h-4 w-4" />
              </button>
              <div
                v-if="img.invalid"
                class="absolute inset-x-1 bottom-1 bg-error px-1 py-0.5 text-xs text-error-content"
                role="alert"
              >
                {{ img.error }}
              </div>
              <div
                v-if="img.uploading"
                class="absolute inset-1 flex items-center justify-center bg-base-300/80"
                aria-live="polite"
              >
                <span
                  class="metro-spinner metro-spinner--sm text-primary"
                ></span>
                <span class="sr-only">Uploading {{ img.file.name }}</span>
              </div>
            </div>
          </div>
        </div>

        <p v-if="sendError" class="mb-2 text-sm text-error" role="alert">
          {{ sendError }}
        </p>

        <form
          @submit.prevent="handleSendMessage"
          class="flex min-w-0 items-end gap-2"
        >
          <div class="dropdown dropdown-top">
            <button
              type="button"
              class="metro-btn metro-btn--ghost btn-sm btn-square shrink-0"
              @click="toggleEmojiPicker"
              aria-label="Add emoji"
            >
              <Icon name="lucide:smile-plus" class="size-5" />
            </button>
            <div
              v-if="showEmojiPicker"
              class="metro-pane z-50"
              style="
                position: absolute;
                bottom: 100%;
                left: 0;
                margin-bottom: 0.5rem;
              "
            >
              <EmojiPicker @select="insertEmoji" />
            </div>
          </div>

          <button
            type="button"
            class="metro-btn metro-btn--ghost btn-sm btn-square shrink-0"
            @click="openFilePicker"
            aria-label="Upload image"
          >
            <Icon name="lucide:image-plus" class="size-5" />
          </button>

          <div class="relative min-w-0 flex-1">
            <textarea
              v-model="messageText"
              ref="chatTextarea"
              aria-label="Message"
              :placeholder="
                chatStore.offline
                  ? 'Write a message to send when you’re back online…'
                  : 'Type a message…'
              "
              class="metro-input min-h-[2.5rem] max-h-[6.5rem] w-full resize-none overflow-y-auto pr-8"
              @input="handleTextareaInput"
              @focus="handleFocus"
              @blur="handleBlur"
              @keydown="handleKeydown"
              @paste="handlePaste"
              maxlength="1000"
              rows="1"
              autocomplete="off"
              spellcheck="false"
            ></textarea>
          </div>
          <button
            type="submit"
            class="metro-btn shrink-0"
            aria-label="Send message"
            :disabled="
              (!messageText.trim() && pendingImages.length === 0) || sending
            "
          >
            <span v-if="sending" class="metro-spinner metro-spinner--xs"></span>
            <Icon v-else name="lucide:send" class="size-6" />
          </button>
        </form>

        <div
          v-if="typingUsers.length > 0"
          class="mt-2 text-xs text-base-content/60"
        >
          <div class="flex items-center gap-2">
            <div class="flex space-x-1">
              <div class="w-1 h-1 bg-primary rounded-full animate-bounce"></div>
              <div
                class="w-1 h-1 bg-primary rounded-full animate-bounce"
                style="animation-delay: 0.1s"
              ></div>
              <div
                class="w-1 h-1 bg-primary rounded-full animate-bounce"
                style="animation-delay: 0.2s"
              ></div>
            </div>
            <span>
              {{ getTypingText() }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </ImageUploadArea>
</template>

<script setup>
import { debugLog } from "../../shared/debug";
import { useChatStore } from "../../stores/chat";
import {
  uploadChatFile,
  deleteChatFile,
  validateImageFile,
  readFileAsDataURL,
  getImageDimensions,
} from "../../shared/image-upload";
import EmojiPicker from "./EmojiPicker.vue";
import ImageUploadArea from "./ImageUploadArea.vue";

const props = defineProps({
  channelId: {
    type: String,
    required: true,
  },
  connected: {
    type: Boolean,
    default: false,
  },
  typingUsers: {
    type: Array,
    default: () => [],
  },
  replyingTo: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(["message-sent", "cancel-reply"]);

const chatStore = useChatStore();
const config = useRuntimeConfig();
const apiPath = config.public.apiPath || "/api";
const messageText = ref("");
const isTyping = ref(false);
const typingTimeout = ref(null);
const chatTextarea = ref(null);
const showEmojiPicker = ref(false);
const sending = ref(false);
const sendError = ref("");
const pendingImages = ref([]);
const uploadArea = ref(null);

onMounted(() => {
  nextTick(() => {
    if (chatTextarea.value) {
      chatTextarea.value.focus();
    }
  });
});

function toggleEmojiPicker() {
  showEmojiPicker.value = !showEmojiPicker.value;
}

function insertEmoji(emoji) {
  const textarea = chatTextarea.value;
  if (!textarea) {
    messageText.value += emoji;
  } else {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = messageText.value.slice(0, start);
    const after = messageText.value.slice(end);
    messageText.value = before + emoji + after;
    nextTick(() => {
      textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
      textarea.focus();
    });
  }
  showEmojiPicker.value = false;
}

function onImagesAdded(images) {
  pendingImages.value = images;
}

function removeImage(index) {
  pendingImages.value.splice(index, 1);
}

async function handleSendMessage() {
  if (sending.value) return;
  if (!messageText.value.trim() && pendingImages.value.length === 0) return;

  sending.value = true;
  sendError.value = "";
  const uploadedAttachmentIds = [];
  try {
    const attachments = [];
    for (const img of pendingImages.value) {
      img.uploading = true;
      try {
        if (img.invalid) throw new Error(img.error || "Invalid image");
        const result = await uploadChatFile(
          img.file,
          props.channelId,
          apiPath,
          { width: img.width, height: img.height },
        );
        uploadedAttachmentIds.push(result.id);
        attachments.push({
          id: result.id,
          url: result.url,
          name: result.name,
          size: result.size,
          mime_type: result.mime_type,
          width: result.width,
          height: result.height,
        });
      } catch (err) {
        console.error("Failed to upload image:", err);
        throw new Error(`Image upload failed: ${err.message}`);
      } finally {
        img.uploading = false;
      }
    }
    const content = messageText.value.trim();

    const result = await chatStore.sendMessage(props.channelId, content, {
      attachments,
      replyTo: props.replyingTo?.id || null,
    });
    messageText.value = "";
    pendingImages.value = [];
    uploadArea.value?.clearImages();
    nextTick(() => adjustTextareaHeight());
    if (isTyping.value) {
      chatStore.sendTypingIndicator(false);
      isTyping.value = false;
    }
    if (result.status && result.status.includes("queued")) {
      debugLog("Message queued for background sync");
    }
    emit("message-sent", result);
  } catch (error) {
    await Promise.allSettled(
      uploadedAttachmentIds.map((id) => deleteChatFile(id, apiPath)),
    );
    console.error("Failed to send message:", error);
    sendError.value = error.message || "Message could not be sent";
  } finally {
    sending.value = false;
  }
}

function handlePaste(event) {}

function handleTextareaInput(e) {
  handleTyping();
  adjustTextareaHeight();
}

function adjustTextareaHeight() {
  const el = chatTextarea.value;
  if (!el) return;
  el.style.height = "auto";
  const maxHeight = 3 * 2.1 + 0.8;
  el.style.height = Math.min(el.scrollHeight, maxHeight * 16) + "px";
}

watch(messageText, () => nextTick(() => adjustTextareaHeight()));

function handleTyping() {
  if (!props.connected) return;
  if (!isTyping.value) {
    isTyping.value = true;
    chatStore.sendTypingIndicator(true);
  }
  if (typingTimeout.value) {
    clearTimeout(typingTimeout.value);
  }
  typingTimeout.value = setTimeout(() => {
    if (isTyping.value) {
      isTyping.value = false;
      chatStore.sendTypingIndicator(false);
    }
  }, 3000);
}

function handleKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleSendMessage();
  }
}

function handleFocus() {}

function handleBlur() {
  if (isTyping.value) {
    isTyping.value = false;
    chatStore.sendTypingIndicator(false);
  }
  if (typingTimeout.value) {
    clearTimeout(typingTimeout.value);
  }
}

function getTypingText() {
  const count = props.typingUsers.length;
  if (count === 0) return "";
  if (count === 1) {
    return "Someone is typing...";
  } else if (count === 2) {
    return "2 people are typing...";
  } else {
    return `${count} people are typing...`;
  }
}

function getReplyPreview() {
  if (!props.replyingTo) return "";
  const content = props.replyingTo.content || "";
  return content.length > 50 ? content.slice(0, 50) + "..." : content;
}

onUnmounted(() => {
  if (typingTimeout.value) {
    clearTimeout(typingTimeout.value);
  }
  if (isTyping.value) {
    chatStore.sendTypingIndicator(false);
  }
});
</script>

<style scoped>
@keyframes bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-5px);
  }
}

.animate-bounce {
  animation: bounce 1.4s infinite;
}
</style>
