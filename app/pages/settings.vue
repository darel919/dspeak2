<template>
  <div class="metro-page text-base-content">
    <div
      class="mx-auto flex max-w-6xl flex-col overflow-hidden border border-base-300 bg-base-100 lg:min-h-[680px] lg:flex-row"
    >
      <aside
        class="border-b border-base-300 bg-base-200/55 px-4 py-4 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r lg:px-4 lg:py-5"
      >
        <div class="flex items-center justify-between lg:block">
          <div>
            <div class="flex items-center gap-2 text-base font-bold">
              <Icon
                name="lucide:settings"
                class="size-4 text-primary"
              />Settings
            </div>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm lg:hidden"
            aria-label="Close settings"
            @click="goBack"
          >
            <Icon name="lucide:x" class="size-5" />
          </button>
        </div>
        <nav
          class="mt-4 grid grid-cols-2 gap-1 sm:grid-cols-4 lg:block lg:space-y-1"
          aria-label="Settings categories"
        >
          <button
            v-for="item in settingsNavigation"
            :key="item.id"
            type="button"
            class="metro-transition flex min-h-11 min-w-0 items-center justify-center gap-2 px-3 py-2 text-sm font-medium lg:w-full lg:justify-start"
            :class="
              activeSection === item.id
                ? 'bg-primary/12 text-base-content'
                : 'text-base-content/65 hover:bg-base-300/70 hover:text-base-content'
            "
            @click="activeSection = item.id"
          >
            <Icon :name="item.icon" class="size-4 shrink-0" /><span
              class="truncate"
              >{{ item.label }}</span
            >
          </button>
        </nav>
        <button
          type="button"
          class="btn btn-ghost btn-sm mt-5 hidden w-full justify-start gap-2 lg:flex"
          @click="goBack"
        >
          <Icon name="lucide:arrow-left" class="size-4" />Back
        </button>
      </aside>

      <main class="min-w-0 flex-1 px-4 py-6 sm:px-7 lg:px-8 lg:py-7">
        <div class="mx-auto max-w-3xl">
          <header class="mb-6 border-b border-base-300 pb-5">
            <h1 class="metro-title text-3xl">
              {{ activeSectionMeta.title }}
            </h1>
            <p class="mt-1 text-sm text-base-content/60">
              {{ activeSectionMeta.description }}
            </p>
          </header>

          <section v-if="activeSection === 'account'" class="space-y-5">
            <div v-if="profile" class="bg-base-100">
              <div class="flex items-center gap-4 sm:gap-5">
                <div class="avatar shrink-0">
                  <div class="w-16 bg-base-200 ring-2 ring-base-100 sm:w-20">
                    <ProfileAvatar
                      :src="profileAvatarPreview"
                      :name="
                        profileDisplayName || profile?.name || profile?.email
                      "
                      class="size-full"
                    />
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="mb-1 flex flex-wrap items-center gap-2">
                    <h2 class="truncate text-lg font-bold sm:text-xl">
                      {{ profileDisplayName || profile?.name }}
                    </h2>
                  </div>
                  <p class="truncate text-sm text-base-content/60">
                    {{ profile?.email }}
                  </p>
                  <p
                    v-if="profileHandle"
                    class="mt-1 truncate text-xs font-medium text-primary"
                  >
                    @{{ profileHandle }}
                  </p>
                </div>
              </div>
            </div>
            <div v-else class="settings-panel">
              <p class="p-5 text-error">Profile information is unavailable.</p>
            </div>
            <form
              class="overflow-hidden border border-base-300 bg-base-100"
              @submit.prevent="saveProfile"
            >
              <div
                class="flex items-start gap-3 border-b border-base-300 bg-base-200/35 px-5 py-4 sm:px-6"
              >
                <span
                  class="grid size-9 shrink-0 place-items-center bg-primary/12 text-primary"
                >
                  <Icon name="lucide:user-round-pen" class="size-4" />
                </span>
                <div>
                  <h2 class="font-semibold">Public profile</h2>
                  <p class="mt-0.5 text-sm leading-5 text-base-content/60">
                    Your unique username identifies your account. Your display
                    name and picture appear across dSpeak.
                  </p>
                </div>
              </div>
              <div class="p-5 sm:p-6">
                <div class="grid gap-6 sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <div>
                    <span class="mb-2 block text-sm font-semibold"
                      >Profile picture</span
                    >
                    <button
                      type="button"
                      class="group relative block overflow-hidden text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      aria-label="Choose a new profile picture"
                      @click="openAvatarPicker"
                    >
                      <ProfileAvatar
                        :src="profileAvatarPreview"
                        :name="
                          profileDisplayName || profile?.name || profile?.email
                        "
                        class="size-28 object-cover sm:size-32"
                      />
                      <span
                        class="metro-transition absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-neutral px-2 py-2 text-xs font-semibold text-neutral-content"
                      >
                        <Icon name="lucide:camera" class="size-3.5" /> Change
                      </span>
                    </button>
                    <input
                      ref="avatarInput"
                      class="sr-only"
                      type="file"
                      aria-label="Choose profile picture"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      @change="selectProfileAvatar"
                    />
                    <p class="mt-2 text-xs leading-4 text-base-content/50">
                      JPG, PNG, WebP or animated GIF. Max 5 MB.
                    </p>
                  </div>
                  <div class="grid content-start gap-5">
                    <label class="grid gap-2">
                      <span class="text-sm font-semibold">Display name</span>
                      <input
                        v-model="profileDisplayName"
                        class="input input-bordered w-full bg-base-100 focus:outline-primary"
                        type="text"
                        minlength="2"
                        maxlength="32"
                        autocomplete="nickname"
                        required
                      />
                      <span class="text-xs text-base-content/50">
                        This is how people will see you in rooms.
                      </span>
                    </label>
                    <label class="grid gap-2">
                      <span class="text-sm font-semibold">Username</span>
                      <div
                        class="input input-bordered flex w-full items-center gap-2 bg-base-100 focus-within:outline-2 focus-within:outline-primary"
                      >
                        <span class="font-semibold text-base-content/35"
                          >@</span
                        >
                        <input
                          v-model="profileHandle"
                          class="min-w-0 grow outline-none"
                          type="text"
                          minlength="3"
                          maxlength="32"
                          pattern="[a-z0-9_]+"
                          autocomplete="username"
                          required
                        />
                      </div>
                      <span class="text-xs text-base-content/50">
                        Lowercase letters, numbers and underscores only.
                      </span>
                    </label>
                  </div>
                </div>
              </div>
              <div
                class="flex flex-col gap-3 border-t border-base-300 bg-base-200/25 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <p
                  v-if="profileMessage"
                  class="flex items-center gap-2 text-sm"
                  :class="profileError ? 'text-error' : 'text-success'"
                  role="status"
                >
                  <Icon
                    :name="
                      profileError
                        ? 'lucide:circle-alert'
                        : 'lucide:circle-check'
                    "
                    class="size-4"
                  />
                  {{ profileMessage }}
                </p>
                <span
                  v-else
                  class="hidden text-xs text-base-content/45 sm:block"
                >
                  Changes apply across every room.
                </span>
                <button
                  class="btn btn-primary sm:min-w-36"
                  type="submit"
                  :disabled="profileSaving"
                >
                  <span
                    v-if="profileSaving"
                    class="loading loading-spinner loading-xs"
                  ></span>
                  <Icon v-else name="lucide:save" class="size-4" />
                  {{ profileSaving ? "Saving…" : "Save changes" }}
                </button>
              </div>
            </form>
            <div
              class="metro-status flex-col sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <h2 class="text-sm font-semibold">Sign out of dSpeak</h2>
                <p class="mt-1 text-xs text-base-content/55">
                  End the current session on this device.
                </p>
              </div>
              <button
                type="button"
                class="btn btn-error btn-outline"
                @click="handleLogout"
              >
                <Icon name="lucide:log-out" class="size-4" />Log out
              </button>
            </div>

            <div
              class="flex flex-col gap-4 border-t border-base-300 pt-6 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <h3 class="text-lg font-medium">Export your data</h3>
                <p class="mt-1 text-sm text-base-content/60">
                  Download a JSON file containing your profile, messages, rooms,
                  settings, and all associated data.
                </p>
              </div>
              <button
                class="btn btn-primary"
                :disabled="exporting"
                :aria-busy="exporting"
                @click="handleExport"
              >
                <span
                  v-if="exporting"
                  class="loading loading-spinner loading-sm"
                />
                <span v-else>
                  <Icon name="lucide:download" class="size-4 mr-2" />Export data
                </span>
              </button>
            </div>

            <div
              class="flex flex-col gap-4 border-t border-base-300 pt-6 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <h3 class="text-lg font-medium text-error">
                  Delete your account
                </h3>
                <p class="mt-1 text-sm text-base-content/60">
                  Deactivate your profile, remove your account data, and
                  anonymize messages that remain in shared rooms.
                </p>
              </div>
              <button
                class="btn btn-error"
                :disabled="deleting"
                :aria-busy="deleting"
                @click="confirmDelete = true"
              >
                <span
                  v-if="deleting"
                  class="loading loading-spinner loading-sm"
                />
                <span v-else>
                  <Icon name="lucide:trash-2" class="size-4 mr-2" />Delete
                  account
                </span>
              </button>
            </div>
          </section>

          <div
            v-if="confirmDelete"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            @click.self="confirmDelete = false"
          >
            <div
              ref="deleteDialog"
              class="w-full max-w-md rounded-box bg-base-100 p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-account-title"
              tabindex="-1"
              @keydown.esc.stop="confirmDelete = false"
            >
              <h2
                id="delete-account-title"
                class="text-2xl font-semibold text-error"
              >
                Delete your account?
              </h2>
              <p class="mt-3 text-base-content/70">
                This will deactivate your profile, remove your settings and
                personal records, and anonymize messages you sent in rooms that
                remain. You cannot undo this action.
              </p>
              <div class="mt-6 flex gap-3 justify-end">
                <button class="btn btn-ghost" @click="confirmDelete = false">
                  Cancel
                </button>
                <button
                  class="btn btn-error"
                  :disabled="deleting"
                  :aria-busy="deleting"
                  @click="handleDelete"
                >
                  <span
                    v-if="deleting"
                    class="loading loading-spinner loading-sm"
                  />
                  <span v-else>Yes, delete my account</span>
                </button>
              </div>
            </div>
          </div>

          <section v-else-if="activeSection === 'voice'" class="space-y-6">
            <div id="microphone-settings" class="settings-panel scroll-mt-6">
              <div class="settings-panel-heading">
                <div>
                  <h2>Microphone setup</h2>
                  <p>
                    Choose your microphone, check its level, and hear it back.
                  </p>
                </div>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="devicesLoading"
                  @click="refreshDevices"
                >
                  <span
                    v-if="devicesLoading"
                    class="loading loading-spinner loading-xs"
                  ></span
                  ><Icon
                    v-else
                    name="lucide:refresh-cw"
                    class="size-4"
                  />Refresh
                </button>
              </div>
              <div class="grid gap-5 border-t border-base-300 p-5 sm:p-6">
                <label class="grid gap-2">
                  <span class="flex items-center gap-2 text-sm font-semibold">
                    <Icon name="lucide:mic" class="size-4 text-primary" />
                    Input device
                  </span>
                  <select
                    v-model="selectedDeviceId"
                    class="select select-bordered w-full bg-base-100"
                    :disabled="devicesLoading || !devices.length"
                    @change="onDeviceChange"
                  >
                    <option value="">System default</option>
                    <option
                      v-if="selectedMicrophoneUnavailable"
                      :value="selectedDeviceId"
                    >
                      Previously selected microphone (unavailable)
                    </option>
                    <option
                      v-for="d in devices"
                      :key="d.deviceId"
                      :value="d.deviceId"
                    >
                      {{ d.label || "Microphone" }}
                    </option>
                  </select>
                </label>

                <div class="grid gap-4">
                  <div
                    class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div>
                      <h3 class="font-semibold">Mic check</h3>
                      <p
                        class="mt-1 max-w-xl text-sm leading-5 text-base-content/60"
                      >
                        Record a short sample, then play it back through your
                        selected speakers. Your sample stays on this device.
                      </p>
                    </div>
                    <button
                      type="button"
                      class="btn min-w-36"
                      :class="micCheckRecording ? 'btn-error' : 'btn-primary'"
                      :disabled="
                        microphonePreviewLoading ||
                        (!microphonePreviewReady && !micCheckRecording)
                      "
                      @click="toggleMicCheck"
                    >
                      <span
                        v-if="microphonePreviewLoading"
                        class="loading loading-spinner loading-xs"
                      ></span>
                      <Icon
                        v-else
                        :name="
                          micCheckRecording
                            ? 'lucide:square'
                            : 'lucide:circle-dot'
                        "
                        class="size-4"
                      />
                      {{
                        micCheckRecording
                          ? `Stop · ${micCheckSeconds}s`
                          : "Record mic check"
                      }}
                    </button>
                  </div>

                  <div>
                    <div
                      class="mb-2 flex flex-wrap items-center justify-between gap-2"
                    >
                      <span
                        class="flex items-center gap-2 text-sm font-semibold"
                      >
                        <span
                          class="size-2.5 rounded-full"
                          :class="microphonePreviewStatusClass"
                        ></span>
                        {{ microphonePreviewStatus }}
                      </span>
                      <span class="text-xs tabular-nums text-base-content/60">
                        {{ Math.round(microphoneLevelDbValue) }} dBFS
                        <template v-if="effectiveGateEnabled">
                          · gate {{ Math.round(effectiveGateThresholdDb) }} dBFS
                        </template>
                      </span>
                    </div>
                    <div
                      class="relative h-4 overflow-hidden bg-base-300"
                      role="meter"
                      aria-label="Live microphone input level"
                      aria-valuemin="-60"
                      aria-valuemax="0"
                      :aria-valuenow="Math.round(microphoneLevelDbValue)"
                    >
                      <div
                        class="h-full transition-[width,background-color] duration-75"
                        :class="
                          microphoneGateOpen ? 'bg-success' : 'bg-warning/70'
                        "
                        :style="{ width: `${microphoneLevelPercent}%` }"
                      ></div>
                      <span
                        v-if="effectiveGateEnabled"
                        class="absolute inset-y-0 w-0.5 bg-base-content"
                        :style="{ left: `${microphoneThresholdPercent}%` }"
                      ></span>
                    </div>
                  </div>

                  <p
                    v-if="microphonePreviewError || micCheckError"
                    class="text-sm text-error"
                    role="alert"
                  >
                    {{ micCheckError || microphonePreviewError }}
                  </p>
                  <div
                    v-if="micCheckUrl"
                    class="flex flex-col gap-3 border-t border-base-300 pt-4 sm:flex-row sm:items-center"
                  >
                    <audio
                      ref="micCheckAudio"
                      class="h-10 min-w-0 flex-1"
                      :src="micCheckUrl"
                      controls
                      @play="applyMicCheckOutput"
                    ></audio>
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost"
                      @click="clearMicCheck"
                    >
                      <Icon name="lucide:trash-2" class="size-4" />
                      Discard
                    </button>
                  </div>
                  <p v-else class="text-xs leading-5 text-base-content/55">
                    The meter is live. The marker shows where the microphone
                    gate opens.
                  </p>
                </div>
              </div>
              <div
                v-if="devicesError"
                class="border-t border-base-300 px-5 py-3 text-xs text-error"
              >
                {{ devicesError }}
              </div>
            </div>

            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>Microphone processing</h2>
                  <p>Fine-tune what other people hear.</p>
                </div>
                <button
                  v-if="microphonePreviewError"
                  type="button"
                  class="btn btn-sm btn-outline"
                  @click="startMicrophonePreview"
                >
                  <Icon name="lucide:refresh-cw" class="size-4" />Try again
                </button>
              </div>
              <div class="divide-y divide-base-300">
                <label class="settings-toggle-row"
                  ><span
                    ><strong>Microphone gate</strong
                    ><small
                      >Stops sending microphone audio while you are not
                      speaking.</small
                    ></span
                  ><span class="flex items-center gap-3"
                    ><span
                      v-if="hdAudioEnabled"
                      class="text-xs text-base-content/50"
                      >Off for HD audio</span
                    ><input
                      type="checkbox"
                      class="toggle toggle-primary"
                      :checked="microphoneGate.enabled && !hdAudioEnabled"
                      :disabled="hdAudioEnabled"
                      @change="
                        setMicrophoneGateEnabled($event.target.checked)
                      " /></span
                ></label>
                <label
                  v-if="microphoneGate.enabled && !hdAudioEnabled"
                  class="settings-toggle-row"
                  ><span
                    ><strong>Automatic gate</strong
                    ><small
                      >Adapts the opening level to your room's background
                      noise.</small
                    ></span
                  ><input
                    type="checkbox"
                    class="toggle toggle-primary"
                    :checked="microphoneGate.automatic"
                    @change="setAutomaticGate($event.target.checked)"
                /></label>
                <label
                  v-if="
                    microphoneGate.enabled &&
                    !microphoneGate.automatic &&
                    !hdAudioEnabled
                  "
                  class="settings-row"
                  ><span class="settings-row-label"
                    ><Icon name="lucide:audio-waveform" />Gate threshold
                    <small
                      >Lower values open for quieter sounds. Current:
                      {{ microphoneGate.thresholdDb }} dB</small
                    ></span
                  ><input
                    class="range range-primary w-full max-w-md"
                    type="range"
                    min="-60"
                    max="-20"
                    step="1"
                    :value="microphoneGate.thresholdDb"
                    @input="setGateThreshold($event.target.value)"
                /></label>
                <label
                  v-for="option in audioProcessingOptions"
                  :key="option.key"
                  class="settings-toggle-row"
                  ><span
                    ><strong>{{ option.label }}</strong
                    ><small>{{ option.description }}</small></span
                  ><span class="flex items-center gap-3"
                    ><span
                      v-if="!supported[option.key]"
                      class="text-xs text-base-content/50"
                      >Unavailable</span
                    ><input
                      type="checkbox"
                      class="toggle toggle-primary"
                      :checked="audio[option.key]"
                      :disabled="!supported[option.key]"
                      @change="
                        onToggle(option.key, $event.target.checked)
                      " /></span
                ></label>
              </div>
              <div
                class="flex flex-wrap items-center gap-3 border-t border-base-300 bg-base-200/50 px-5 py-4"
              >
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  :disabled="applyBusy || !voiceStore.connected"
                  @click="applyAudioSettings"
                >
                  <span
                    v-if="applyBusy"
                    class="loading loading-spinner loading-xs"
                  ></span
                  >Apply to current call</button
                ><span class="text-xs text-base-content/60">{{
                  voiceStore.connected
                    ? "Restarts your microphone with these settings."
                    : "Join a voice channel to apply live."
                }}</span>
              </div>
            </div>

            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>Other devices</h2>
                  <p>Choose where calls play and which camera dSpeak uses.</p>
                </div>
              </div>
              <div class="divide-y divide-base-300">
                <label class="settings-row"
                  ><span class="settings-row-label"
                    ><Icon name="lucide:volume-2" />Speakers</span
                  ><select
                    v-model="selectedOutputId"
                    class="select select-bordered w-full max-w-md"
                    :disabled="
                      devicesLoading || !outputDevices.length || !canSetSinkId
                    "
                    @change="onOutputChange"
                  >
                    <option value="">System default</option>
                    <option
                      v-for="d in outputDevices"
                      :key="d.deviceId"
                      :value="d.deviceId"
                    >
                      {{ d.label || "Speaker" }}
                    </option>
                  </select></label
                >
                <label id="camera-settings" class="settings-row scroll-mt-6"
                  ><span class="settings-row-label"
                    ><Icon name="lucide:video" />Camera</span
                  ><select
                    v-model="selectedCameraId"
                    class="select select-bordered w-full max-w-md"
                    :disabled="devicesLoading || !videoDevices.length"
                    @change="onCameraDeviceChange"
                  >
                    <option value="">System default</option>
                    <option
                      v-for="d in videoDevices"
                      :key="d.deviceId"
                      :value="d.deviceId"
                    >
                      {{ d.label || "Camera" }}
                    </option>
                  </select></label
                >
              </div>
              <p
                v-if="!canSetSinkId"
                class="border-t border-base-300 px-5 py-3 text-xs text-base-content/60"
              >
                This browser uses the system output and can’t select separate
                speakers.
              </p>
            </div>

            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>Video quality</h2>
                  <p>Set separate limits for camera and screen sharing.</p>
                </div>
              </div>
              <div
                class="grid divide-y divide-base-300 md:grid-cols-2 md:divide-x md:divide-y-0"
              >
                <div
                  v-for="video in videoQualitySections"
                  :key="video.id"
                  class="p-5"
                >
                  <div class="mb-4 flex items-center gap-3">
                    <span
                      class="grid size-9 place-items-center bg-primary/10 text-primary"
                      ><Icon :name="video.icon" class="size-5"
                    /></span>
                    <h3 class="font-semibold">{{ video.label }}</h3>
                  </div>
                  <label class="form-control"
                    ><span
                      class="mb-1.5 text-xs font-semibold text-base-content/65"
                      >Resolution</span
                    ><select
                      class="select select-bordered w-full bg-base-100"
                      :value="video.settings.resolution"
                      @change="video.setResolution($event.target.value)"
                    >
                      <option
                        v-for="option in resolutionOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select></label
                  >
                  <label class="form-control mt-4"
                    ><span
                      class="mb-1.5 text-xs font-semibold text-base-content/65"
                      >Frame rate</span
                    ><select
                      class="select select-bordered w-full bg-base-100"
                      :value="video.settings.frameRate"
                      @change="video.setFrameRate($event.target.value)"
                    >
                      <option
                        v-for="fps in frameRateOptions"
                        :key="fps"
                        :value="fps"
                      >
                        {{ fps }} FPS
                      </option>
                    </select></label
                  >
                  <label class="form-control mt-4"
                    ><span
                      class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-base-content/60"
                      >Quality priority</span
                    ><select
                      class="select select-bordered w-full bg-base-100"
                      :value="video.settings.qualityPriority"
                      @change="video.setQualityPriority($event.target.value)"
                    >
                      <option value="framerate">Prioritize maximum FPS</option>
                      <option value="resolution">Prioritize resolution</option>
                    </select></label
                  >
                  <p class="mt-2 text-xs text-base-content/60">
                    {{
                      video.settings.qualityPriority === "resolution"
                        ? "Preserves resolution and may reduce cadence, never below 24 FPS."
                        : "Keeps cadence as close to the selected FPS as possible."
                    }}
                  </p>
                </div>
              </div>
              <p
                class="border-t border-base-300 px-5 py-3 text-xs text-base-content/60"
              >
                Resolution limits never upscale the source. Original preserves
                the source's full resolution.
              </p>
            </div>

            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>Soundboard playback</h2>
                  <p>Set the default volume used across rooms.</p>
                </div>
                <span class="badge badge-outline"
                  >{{ settingsStore.soundboardVolume }}%</span
                >
              </div>
              <label class="settings-row"
                ><span
                  ><strong class="block text-sm">Global volume</strong
                  ><small
                    >Rooms can override this from their soundboard.</small
                  ></span
                ><input
                  class="range range-primary w-full max-w-xs"
                  type="range"
                  min="0"
                  max="100"
                  :value="settingsStore.soundboardVolume"
                  @input="
                    settingsStore.setSoundboardVolume($event.target.value)
                  "
              /></label>
            </div>

            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>System sound theme</h2>
                  <p>dSpeak sounds for voice and screen-sharing events.</p>
                </div>
                <button
                  type="button"
                  class="btn btn-sm btn-outline"
                  @click="previewSystemSound"
                >
                  Preview
                </button>
              </div>
              <div class="divide-y divide-base-300">
                <label class="settings-row"
                  ><span><strong class="block text-sm">Theme</strong></span
                  ><select
                    class="select select-bordered w-full max-w-xs capitalize"
                    :value="settingsStore.systemSoundTheme"
                    @change="
                      settingsStore.setSystemSoundTheme($event.target.value)
                    "
                  >
                    <option
                      v-for="theme in systemSoundThemes"
                      :key="theme"
                      :value="theme"
                    >
                      {{ theme }}
                    </option>
                  </select></label
                >
                <label class="settings-row"
                  ><span
                    ><strong class="block text-sm">Volume</strong
                    ><small>{{ settingsStore.systemSoundVolume }}%</small></span
                  ><input
                    class="range range-primary w-full max-w-xs"
                    type="range"
                    min="0"
                    max="100"
                    :value="settingsStore.systemSoundVolume"
                    @input="
                      settingsStore.setSystemSoundVolume($event.target.value)
                    "
                /></label>
                <label class="settings-toggle-row"
                  ><span
                    ><strong>Mute system sounds</strong
                    ><small
                      >Does not mute soundboards or voice audio.</small
                    ></span
                  ><input
                    type="checkbox"
                    class="toggle toggle-primary"
                    :checked="settingsStore.systemSoundsMuted"
                    @change="
                      settingsStore.setSystemSoundsMuted($event.target.checked)
                    "
                /></label>
              </div>
            </div>

            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>Shared audio</h2>
                  <p>
                    Choose the preferred Opus quality ceiling for system audio.
                  </p>
                </div>
                <span v-if="voiceStore.connected" class="badge badge-outline"
                  >Effective
                  {{ voiceStore.effectiveSystemAudioBitrate }} kbps</span
                >
              </div>
              <label class="settings-row"
                ><span
                  ><strong class="block text-sm">Maximum bitrate</strong
                  ><small class="mt-1 block text-xs text-base-content/60"
                    >The voice channel's own limit still takes priority.</small
                  ></span
                ><select
                  class="select select-bordered w-full max-w-xs"
                  :value="systemAudioBitrate"
                  @change="setSystemAudioBitrate($event.target.value)"
                >
                  <option
                    v-for="kbps in systemAudioBitrateOptions"
                    :key="kbps"
                    :value="kbps"
                  >
                    {{ kbps }} kbps{{ kbps === 256 ? " · highest" : "" }}
                  </option>
                </select></label
              >
            </div>
          </section>

          <section v-else-if="activeSection === 'appearance'" class="space-y-6">
            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>Surface mode</h2>
                  <p>Choose how Metro surfaces adapt to your display.</p>
                </div>
              </div>
              <div class="grid gap-2 p-5 sm:grid-cols-3">
                <button
                  v-for="mode in ['system', 'light', 'dark']"
                  :key="mode"
                  class="btn capitalize"
                  :class="
                    settingsStore.appearance.surfaceMode === mode
                      ? 'btn-primary'
                      : 'btn-outline'
                  "
                  @click="settingsStore.setAppearance({ surfaceMode: mode })"
                >
                  {{ mode }}
                </button>
              </div>
            </div>
            <div class="settings-panel">
              <div class="settings-panel-heading">
                <div>
                  <h2>Personal accent</h2>
                  <p>
                    Rooms temporarily replace this color with their own accent.
                  </p>
                </div>
              </div>
              <div class="grid grid-cols-3 gap-2 p-5 sm:grid-cols-6">
                <button
                  v-for="accent in ROOM_ACCENTS"
                  :key="accent"
                  class="h-20 border-4 text-xs capitalize text-white"
                  :class="
                    settingsStore.appearance.accent === accent
                      ? 'border-base-content'
                      : 'border-transparent'
                  "
                  :style="{ background: accentColor(accent) }"
                  @click="settingsStore.setAppearance({ accent })"
                >
                  {{ accent }}
                </button>
              </div>
            </div>
          </section>

          <section v-else-if="activeSection === 'notifications'">
            <NotificationSettings />
          </section>

          <section v-else-if="activeSection === 'keyboard'">
            <KeyboardShortcutsSettings />
          </section>

          <footer
            class="mt-8 border-t border-base-300 pt-4 text-center text-xs text-base-content/45"
          >
            <span>dSpeak v{{ appVersion }}</span>
            <span v-if="appBuild.shortCommit" class="block">
              commit {{ appBuild.shortCommit
              }}<span v-if="appBuild.branch"> · {{ appBuild.branch }}</span>
            </span>
          </footer>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
import NotificationSettings from "../components/NotificationSettings.vue";
import ProfileAvatar from "../components/ProfileAvatar.vue";
import { useAuthStore } from "../stores/auth";
import { useSettingsStore } from "../stores/settings";
import { useVoiceStore } from "../stores/voice";
import { useRuntimeConfig } from "#app";

import { useToast } from "../composables/useToast";
import {
  SYSTEM_AUDIO_BITRATE_OPTIONS,
  VIDEO_FRAME_RATE_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
} from "../const/media";
import { captureMicrophone } from "../shared/media-capture.js";
import { debugLog } from "../shared/debug";
import {
  automaticGateThreshold,
  createNoiseFloorEstimator,
  microphoneLevelDb,
  updateNoiseFloor,
} from "../shared/microphone-gate.js";
import {
  ROOM_ACCENTS,
  ROOM_ACCENT_LIGHT_COLORS,
} from "~~/shared/room-policy.js";
import {
  availableSystemSoundThemes,
  playSystemSound,
} from "../shared/system-sounds.js";

const authStore = useAuthStore();
const voiceStore = useVoiceStore();
const settingsStore = useSettingsStore();
const channelsStore = useChannelsStore();

const activeSection = ref("account");
const route = useRoute();
const router = useRouter();
const settingsNavigation = [
  { id: "account", label: "Account", icon: "lucide:user-round" },
  { id: "voice", label: "Voice & Video", icon: "lucide:audio-lines" },
  { id: "appearance", label: "Appearance", icon: "lucide:palette" },
  { id: "notifications", label: "Notifications", icon: "lucide:bell" },
  { id: "keyboard", label: "Keyboard", icon: "lucide:keyboard" },
];
const sectionDetails = {
  account: {
    title: "My account",
    description: "Your identity and current dSpeak session.",
  },
  voice: {
    title: "Voice & video",
    description:
      "Configure capture devices, call processing, and media quality.",
  },
  appearance: {
    title: "Appearance",
    description: "Choose your Metro surface and personal accent.",
  },
  notifications: {
    title: "Notifications",
    description: "Choose how this browser alerts you about new activity.",
  },
  keyboard: {
    title: "Keyboard shortcuts",
    description: "View all available keyboard shortcuts and their keybindings.",
  },
};
const activeSectionMeta = computed(() => sectionDetails[activeSection.value]);

watch(
  () => route.query.section,
  (section) => {
    if (settingsNavigation.some((item) => item.id === section)) {
      activeSection.value = section;
    }
  },
  { immediate: true },
);

watch(
  () => [activeSection.value, route.hash],
  async ([, hash]) => {
    if (!hash || !import.meta.client) return;
    await nextTick();
    document.getElementById(hash.slice(1))?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  },
  { immediate: true },
);
const audioProcessingOptions = [
  {
    key: "echoCancellation",
    label: "Echo cancellation",
    description: "Reduce feedback from your speakers.",
  },
  {
    key: "noiseSuppression",
    label: "Noise suppression",
    description: "Reduce steady background noise.",
  },
  {
    key: "autoGainControl",
    label: "Automatic gain",
    description: "Keep microphone loudness at a consistent level.",
  },
];

function goBack() {
  if (window.history.length > 1) router.back();
  else router.push("/");
}

const audio = computed(() => settingsStore.audio);
const microphoneGate = computed(() => settingsStore.microphoneGate);
const hdAudioEnabled = computed(
  () =>
    voiceStore.connected &&
    voiceStore.currentChannelId &&
    channelsStore.getChannelById(voiceStore.currentChannelId)?.mediaPolicy
      ?.hdAudio === true,
);
const supported = computed(() => settingsStore.supported);
const cameraVideo = computed(() => settingsStore.cameraVideo);
const screenVideo = computed(() => settingsStore.screenVideo);
const systemAudioBitrate = computed(() => settingsStore.systemAudioBitrate);
const systemAudioBitrateOptions = SYSTEM_AUDIO_BITRATE_OPTIONS;
const resolutionOptions = VIDEO_RESOLUTION_OPTIONS;
const frameRateOptions = VIDEO_FRAME_RATE_OPTIONS;
const systemSoundThemes = availableSystemSoundThemes();

function previewSystemSound() {
  playSystemSound("voice-join", settingsStore);
}

function accentColor(value) {
  return ROOM_ACCENT_LIGHT_COLORS[value];
}

function setCameraResolution(resolution) {
  settingsStore.setCameraVideoSettings({ resolution });
}
function setCameraFrameRate(frameRate) {
  settingsStore.setCameraVideoSettings({ frameRate: Number(frameRate) });
}
function setCameraQualityPriority(qualityPriority) {
  settingsStore.setCameraVideoSettings({ qualityPriority });
}
function setScreenResolution(resolution) {
  settingsStore.setScreenVideoSettings({ resolution });
}
function setScreenFrameRate(frameRate) {
  settingsStore.setScreenVideoSettings({ frameRate: Number(frameRate) });
}
function setScreenQualityPriority(qualityPriority) {
  settingsStore.setScreenVideoSettings({ qualityPriority });
}
function setSystemAudioBitrate(bitrate) {
  voiceStore.setSystemAudioBitrate(Number(bitrate));
}
const videoQualitySections = computed(() => [
  {
    id: "camera",
    label: "Camera",
    icon: "lucide:video",
    settings: cameraVideo.value,
    setResolution: setCameraResolution,
    setFrameRate: setCameraFrameRate,
    setQualityPriority: setCameraQualityPriority,
  },
  {
    id: "screen",
    label: "Screen share",
    icon: "lucide:monitor-up",
    settings: screenVideo.value,
    setResolution: setScreenResolution,
    setFrameRate: setScreenFrameRate,
    setQualityPriority: setScreenQualityPriority,
  },
]);

const config = useRuntimeConfig();
const appVersion = config.public.appVersion;
const appBuild = config.public.appBuild || {};
const toast = useToast();

const exporting = ref(false);
const deleting = ref(false);
const confirmDelete = ref(false);
const deleteDialog = ref(null);

watch(confirmDelete, async (visible) => {
  if (!visible) return;
  await nextTick();
  deleteDialog.value?.focus();
});

const profile = computed(() => {
  const user = authStore.getUserData();
  if (!user) return null;
  return {
    ...user,
  };
});
const profileDisplayName = ref("");
const profileHandle = ref("");
const profileAvatar = ref(null);
const profileAvatarObjectUrl = ref("");
const avatarInput = ref(null);
const profileSaving = ref(false);
const profileMessage = ref("");
const profileError = ref(false);
const profileAvatarPreview = computed(
  () => profileAvatarObjectUrl.value || profile.value?.avatar || "",
);

watch(
  () => authStore.getUserData(),
  (user) => {
    profileHandle.value = user?.handle || "";
    profileDisplayName.value =
      user?.display_name || user?.name || user?.username || "";
  },
  { immediate: true },
);

const allowedProfileImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function selectProfileAvatar(event) {
  const selected = event.target.files?.[0] || null;
  if (
    selected &&
    (!allowedProfileImageTypes.has(selected.type) ||
      selected.size > 5 * 1024 * 1024)
  ) {
    event.target.value = "";
    profileError.value = true;
    profileMessage.value = "Choose a JPG, PNG, WebP or GIF up to 5 MB.";
    return;
  }
  if (profileAvatarObjectUrl.value) {
    URL.revokeObjectURL(profileAvatarObjectUrl.value);
  }
  profileAvatar.value = selected;
  profileAvatarObjectUrl.value = profileAvatar.value
    ? URL.createObjectURL(profileAvatar.value)
    : "";
  profileMessage.value = "";
  profileError.value = false;
}

function openAvatarPicker() {
  avatarInput.value?.click();
}

function clearAvatarSelection() {
  if (profileAvatarObjectUrl.value) {
    URL.revokeObjectURL(profileAvatarObjectUrl.value);
  }
  profileAvatarObjectUrl.value = "";
  profileAvatar.value = null;
  if (avatarInput.value) avatarInput.value.value = "";
}

async function saveProfile() {
  const userId = authStore.getUserData()?.id;
  if (!userId) return;
  profileSaving.value = true;
  profileMessage.value = "";
  profileError.value = false;
  try {
    const form = new FormData();
    form.set("handle", profileHandle.value);
    form.set("displayName", profileDisplayName.value);
    if (profileAvatar.value)
      form.set("avatar", profileAvatar.value, profileAvatar.value.name);
    const updated = await $fetch(`${config.public.apiPath}/profile`, {
      method: "PATCH",
      credentials: "include",
      body: form,
    });
    authStore.updateUserData(updated);
    voiceStore.upsertUserProfile(updated);
    clearAvatarSelection();
    profileMessage.value = "Profile updated.";
  } catch (error) {
    profileError.value = true;
    profileMessage.value =
      error?.data?.statusMessage ||
      error?.message ||
      "Could not update profile";
  } finally {
    profileSaving.value = false;
  }
}

onBeforeUnmount(clearAvatarSelection);
onBeforeUnmount(stopMicrophonePreview);
onBeforeUnmount(clearMicCheck);

async function handleLogout() {
  await authStore.clearAuth();
  await nextTick();
  await navigateTo("/");
}

async function handleExport() {
  exporting.value = true;
  try {
    const response = await fetch(`${config.public.apiPath}/account/export`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Export failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dspeak-export-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch {
    toast.error("Failed to export data. Please try again.");
  } finally {
    exporting.value = false;
  }
}

async function handleDelete() {
  deleting.value = true;
  try {
    const response = await fetch(`${config.public.apiPath}/account/delete`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) throw new Error("Deletion failed");
    confirmDelete.value = false;
    await authStore.clearAuth();
    await navigateTo("/");
  } catch {
    toast.error("Failed to delete account. Please try again.");
  } finally {
    deleting.value = false;
  }
}

function onToggle(key, checked) {
  settingsStore.setAudioSetting(key, checked);
  restartMicrophonePreview();
}

function setMicrophoneGateEnabled(enabled) {
  settingsStore.setMicrophoneGate({ enabled });
}

function setAutomaticGate(automatic) {
  settingsStore.setMicrophoneGate({ automatic });
}

function setGateThreshold(thresholdDb) {
  settingsStore.setMicrophoneGate({ thresholdDb: Number(thresholdDb) });
}

const applyBusy = ref(false);
async function applyAudioSettings() {
  debugLog("[Settings] Apply audio settings button pressed");
  debugLog(
    "[Settings] voiceStore.connected:",
    voiceStore.connected,
    "voiceStore.sfuComposable:",
    voiceStore.sfuComposable,
  );
  if (!voiceStore.connected || !voiceStore.sfuComposable) {
    console.warn(
      "[Settings] Not applying audio settings: connected =",
      voiceStore.connected,
      "sfuComposable =",
      voiceStore.sfuComposable,
    );
    return;
  }
  applyBusy.value = true;
  try {
    await voiceStore.sfuComposable.restartAudioProduction();
  } catch (error) {
    console.warn("[Settings] Unable to apply audio settings", error);
  } finally {
    applyBusy.value = false;
  }
}

const microphoneLevelDbValue = ref(-60);
const effectiveGateThresholdDb = ref(-48);
const microphonePreviewLoading = ref(false);
const microphonePreviewReady = ref(false);
const microphonePreviewError = ref("");
let microphonePreviewStream = null;
let microphonePreviewContext = null;
let microphonePreviewSource = null;
let microphonePreviewAnalyser = null;
let microphonePreviewGate = null;
let microphonePreviewDestination = null;
let microphonePreviewTimer = null;
let microphonePreviewGeneration = 0;
const micCheckRecording = ref(false);
const micCheckSeconds = ref(0);
const micCheckUrl = ref("");
const micCheckError = ref("");
const micCheckAudio = ref(null);
let micCheckRecorder = null;
let micCheckChunks = [];
let micCheckDurationTimer = null;
let micCheckStopTimer = null;

const effectiveGateEnabled = computed(
  () => microphoneGate.value.enabled && !hdAudioEnabled.value,
);
const microphoneGateOpen = computed(
  () =>
    !effectiveGateEnabled.value ||
    microphoneLevelDbValue.value >= effectiveGateThresholdDb.value,
);
const microphoneLevelPercent = computed(() =>
  Math.max(0, Math.min(100, ((microphoneLevelDbValue.value + 60) / 60) * 100)),
);
const microphoneThresholdPercent = computed(() =>
  Math.max(
    0,
    Math.min(100, ((effectiveGateThresholdDb.value + 60) / 60) * 100),
  ),
);
const microphonePreviewStatus = computed(() => {
  if (microphonePreviewError.value) return "Microphone unavailable";
  if (microphonePreviewLoading.value) return "Starting microphone…";
  if (!microphonePreviewReady.value) return "Microphone preview stopped";
  if (!effectiveGateEnabled.value) return "Gate bypassed";
  return microphoneGateOpen.value ? "Gate open" : "Gate closed";
});
const microphonePreviewStatusClass = computed(() => {
  if (microphonePreviewError.value) return "bg-error";
  if (microphonePreviewLoading.value) return "bg-warning animate-pulse";
  if (!microphonePreviewReady.value) return "bg-base-content/30";
  if (!effectiveGateEnabled.value) return "bg-info";
  return microphoneGateOpen.value ? "bg-success" : "bg-warning";
});

async function startMicrophonePreview() {
  const generation = ++microphonePreviewGeneration;
  stopMicrophonePreviewResources();
  microphonePreviewLoading.value = true;
  microphonePreviewError.value = "";
  try {
    const { stream } = await captureMicrophone({
      settings: settingsStore,
      stereo: hdAudioEnabled.value,
    });
    if (generation !== microphonePreviewGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    microphonePreviewStream = stream;
    const AudioContextConstructor =
      window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor)
      throw new Error("Audio levels are unavailable");
    microphonePreviewContext = new AudioContextConstructor();
    microphonePreviewSource =
      microphonePreviewContext.createMediaStreamSource(stream);
    microphonePreviewAnalyser = microphonePreviewContext.createAnalyser();
    microphonePreviewAnalyser.fftSize = 256;
    microphonePreviewSource.connect(microphonePreviewAnalyser);
    microphonePreviewGate = microphonePreviewContext.createGain();
    microphonePreviewDestination =
      microphonePreviewContext.createMediaStreamDestination();
    microphonePreviewSource.connect(microphonePreviewGate);
    microphonePreviewGate.connect(microphonePreviewDestination);
    const samples = new Float32Array(microphonePreviewAnalyser.fftSize);
    const noiseFloorEstimator = createNoiseFloorEstimator();
    microphonePreviewTimer = setInterval(() => {
      microphonePreviewAnalyser.getFloatTimeDomainData(samples);
      const levelDb = microphoneLevelDb(samples);
      const thresholdDb = microphoneGate.value.automatic
        ? automaticGateThreshold(noiseFloorEstimator.noiseFloorDb)
        : microphoneGate.value.thresholdDb;
      microphoneLevelDbValue.value = Math.max(-60, levelDb);
      effectiveGateThresholdDb.value = thresholdDb;
      updateNoiseFloor(noiseFloorEstimator, levelDb, levelDb >= thresholdDb);
      microphonePreviewGate.gain.setTargetAtTime(
        !effectiveGateEnabled.value || levelDb >= thresholdDb ? 1 : 0,
        microphonePreviewContext.currentTime,
        0.01,
      );
    }, 40);
    await microphonePreviewContext.resume();
    microphonePreviewReady.value = true;
  } catch (error) {
    if (generation !== microphonePreviewGeneration) return;
    stopMicrophonePreviewResources();
    microphonePreviewError.value =
      error?.name === "NotAllowedError"
        ? "Microphone permission is required to show the live gate meter."
        : error?.message || "Could not start the microphone preview.";
  } finally {
    if (generation === microphonePreviewGeneration)
      microphonePreviewLoading.value = false;
  }
}

function stopMicrophonePreviewResources() {
  stopMicCheckRecorder(true);
  if (microphonePreviewTimer) clearInterval(microphonePreviewTimer);
  microphonePreviewTimer = null;
  microphonePreviewSource?.disconnect();
  microphonePreviewAnalyser?.disconnect();
  microphonePreviewGate?.disconnect();
  microphonePreviewStream?.getTracks().forEach((track) => track.stop());
  microphonePreviewContext?.close().catch(() => {});
  microphonePreviewStream = null;
  microphonePreviewContext = null;
  microphonePreviewSource = null;
  microphonePreviewAnalyser = null;
  microphonePreviewGate = null;
  microphonePreviewDestination = null;
  microphonePreviewReady.value = false;
  microphoneLevelDbValue.value = -60;
}

function stopMicrophonePreview() {
  microphonePreviewGeneration += 1;
  stopMicrophonePreviewResources();
  microphonePreviewLoading.value = false;
}

function restartMicrophonePreview() {
  clearMicCheck();
  if (activeSection.value === "voice") startMicrophonePreview();
}

function stopMicCheckTimers() {
  if (micCheckDurationTimer) clearInterval(micCheckDurationTimer);
  if (micCheckStopTimer) clearTimeout(micCheckStopTimer);
  micCheckDurationTimer = null;
  micCheckStopTimer = null;
}

function stopMicCheckRecorder(discard = false) {
  stopMicCheckTimers();
  if (!micCheckRecorder) {
    micCheckRecording.value = false;
    return;
  }
  if (discard) {
    micCheckRecorder.ondataavailable = null;
    micCheckRecorder.onstop = null;
  }
  if (micCheckRecorder.state !== "inactive") micCheckRecorder.stop();
  if (discard) micCheckChunks = [];
  micCheckRecorder = null;
  micCheckRecording.value = false;
}

function stopMicCheck() {
  stopMicCheckRecorder();
}

function startMicCheck() {
  micCheckError.value = "";
  if (!microphonePreviewDestination || !microphonePreviewReady.value) {
    micCheckError.value = "Wait for the microphone to become ready.";
    return;
  }
  if (typeof MediaRecorder === "undefined") {
    micCheckError.value =
      "This browser does not support microphone recording checks.";
    return;
  }
  clearMicCheck();
  micCheckChunks = [];
  micCheckRecorder = new MediaRecorder(microphonePreviewDestination.stream);
  micCheckRecorder.ondataavailable = (event) => {
    if (event.data.size) micCheckChunks.push(event.data);
  };
  micCheckRecorder.onstop = () => {
    const type = micCheckRecorder?.mimeType || micCheckChunks[0]?.type;
    const sample = new Blob(micCheckChunks, { type });
    micCheckRecorder = null;
    micCheckChunks = [];
    micCheckRecording.value = false;
    if (!sample.size) {
      micCheckError.value = "No microphone audio was recorded. Try again.";
      return;
    }
    micCheckUrl.value = URL.createObjectURL(sample);
    nextTick(applyMicCheckOutput);
  };
  micCheckRecorder.start();
  micCheckSeconds.value = 0;
  micCheckRecording.value = true;
  micCheckDurationTimer = setInterval(() => {
    micCheckSeconds.value += 1;
  }, 1000);
  micCheckStopTimer = setTimeout(stopMicCheck, 10000);
}

function toggleMicCheck() {
  if (micCheckRecording.value) stopMicCheck();
  else startMicCheck();
}

function clearMicCheck() {
  stopMicCheckRecorder(true);
  if (micCheckAudio.value) {
    micCheckAudio.value.pause();
    micCheckAudio.value.removeAttribute("src");
    micCheckAudio.value.load();
  }
  if (micCheckUrl.value) URL.revokeObjectURL(micCheckUrl.value);
  micCheckUrl.value = "";
  micCheckSeconds.value = 0;
  micCheckError.value = "";
}

async function applyMicCheckOutput() {
  const audioElement = micCheckAudio.value;
  if (!audioElement?.setSinkId || !selectedOutputId.value) return;
  try {
    await audioElement.setSinkId(selectedOutputId.value);
  } catch (error) {
    micCheckError.value = "The mic check could not use the selected speakers.";
  }
}

const devices = ref([]);
const outputDevices = ref([]);
const videoDevices = ref([]);
const devicesLoading = ref(false);
const devicesError = ref("");
const selectedDeviceId = ref("");
const selectedMicrophoneUnavailable = computed(
  () =>
    Boolean(selectedDeviceId.value) &&
    !devices.value.some((device) => device.deviceId === selectedDeviceId.value),
);

onMounted(async () => {
  selectedDeviceId.value = settingsStore.micDeviceId || "";
  selectedOutputId.value = settingsStore.outputDeviceId || "";
  selectedCameraId.value = settingsStore.cameraDeviceId || "";
  if (activeSection.value === "voice") await startMicrophonePreview();
  await refreshDevices();
});

watch(activeSection, (section) => {
  if (section === "voice") startMicrophonePreview();
  else stopMicrophonePreview();
});

watch(hdAudioEnabled, restartMicrophonePreview);

async function refreshDevices() {
  devicesLoading.value = true;
  devicesError.value = "";
  try {
    if (!navigator.mediaDevices?.enumerateDevices) {
      devicesError.value = "Media devices not supported in this browser.";
      devices.value = [];
      return;
    }

    const labelsKnown = (await navigator.mediaDevices.enumerateDevices()).some(
      (d) => d.label,
    );
    if (!labelsKnown) {
      let permissionStream = null;
      try {
        permissionStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
      } catch {
      } finally {
        permissionStream?.getTracks().forEach((track) => track.stop());
      }
    }
    const list = await navigator.mediaDevices.enumerateDevices();
    devices.value = list.filter((d) => d.kind === "audioinput");
    outputDevices.value = list.filter((d) => d.kind === "audiooutput");
    videoDevices.value = list.filter((d) => d.kind === "videoinput");
  } catch (e) {
    devicesError.value = "Failed to enumerate devices.";
  } finally {
    devicesLoading.value = false;
  }
}

function onDeviceChange() {
  const id = selectedDeviceId.value || null;
  settingsStore.setMicDeviceId(id);
  restartMicrophonePreview();
}

function handleMediaDevicesChanged() {
  refreshDevices();
}

onMounted(() => {
  navigator.mediaDevices?.addEventListener?.(
    "devicechange",
    handleMediaDevicesChanged,
  );
});

onBeforeUnmount(() => {
  navigator.mediaDevices?.removeEventListener?.(
    "devicechange",
    handleMediaDevicesChanged,
  );
});

const canSetSinkId =
  typeof document !== "undefined" &&
  typeof document.createElement("audio").setSinkId === "function";
const selectedOutputId = ref("");
const selectedCameraId = ref("");
function onCameraDeviceChange() {
  settingsStore.setCameraDeviceId(selectedCameraId.value || null);
}
function onOutputChange() {
  const id = selectedOutputId.value || null;
  settingsStore.setOutputDeviceId(id);
  applyMicCheckOutput();

  if (voiceStore.sfuComposable && voiceStore.connected) {
    voiceStore.sfuComposable.applyOutputDeviceToAll();
  }
}
</script>
