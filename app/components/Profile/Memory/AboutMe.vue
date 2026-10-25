<template>
  <ProfileSecuritySectionCard
    heading="About me"
    :description="description"
  >
    <div class="grid gap-3">
      <textarea
        ref="textarea"
        v-model="draft"
        class="
          textarea textarea-bordered rounded-box min-h-36 w-full
          resize-none max-h-[min(300px,33dvh)] overflow-y-auto
        "
        :class="{ 'textarea-error': isOverLimit || !!saveError }"
        aria-label="About me"
        :placeholder="placeholder"
        data-testid="memory-about-me-input"
        :aria-invalid="isOverLimit || !!saveError"
        :aria-describedby="saveError ? 'memory-about-me-error' : undefined"
        :disabled="isSaving"
        @input="saveError = null"
      />
      <p
        class="text-xs"
        :class="isOverLimit ? 'text-error' : 'text-base-content/70'"
        data-testid="memory-about-me-counter"
      >
        {{ draft.length }} / {{ MEMORY_LIMITS.maxAboutMeChars }}
      </p>
      <div
        v-if="saveError"
        id="memory-about-me-error"
        role="alert"
        class="alert alert-soft alert-error !items-start"
        data-testid="memory-about-me-error"
      >
        <Icon
          name="lucide:circle-alert"
          size="20"
          class="mt-0.5 shrink-0"
        />
        <div class="grid gap-1">
          <p class="font-bold">{{ saveError.message }}</p>
          <p v-if="saveError.why" class="text-sm">{{ saveError.why }}</p>
          <p v-if="saveError.fix" class="text-sm">{{ saveError.fix }}</p>
        </div>
      </div>
      <div class="flex flex-wrap justify-end gap-2">
        <UiButton
          v-if="draft"
          mode="neutral"
          ghost
          size="sm"
          text="Clear"
          :disabled="isSaving"
          data-testid="memory-about-me-clear"
          @click="clearDraft"
        />
        <button
          type="button"
          class="btn btn-primary btn-sm max-sm:btn-block"
          :class="{ 'btn-disabled': isSaveDisabled }"
          :disabled="isSaveDisabled"
          data-testid="memory-about-me-save"
          @click="saveAboutMe"
        >
          <span
            v-if="isSaving"
            class="loading loading-spinner loading-xs"
          />
          <span v-else>
            Save
          </span>
        </button>
      </div>
    </div>
  </ProfileSecuritySectionCard>
</template>

<script setup lang="ts">
import type { MemorySettingsFields } from '#shared/types/memory.d'
import type {
  MemorySaveError,
  MemorySettingsSave,
} from '~/types/memory-settings.d'

const props = defineProps<{
  settings: MemorySettingsFields
  save: MemorySettingsSave
}>()

const description = 'Sent with every chat so the assistant knows who you are. '
  + 'Keep it short and avoid secrets.'
const placeholder = 'For example: I\'m a backend developer who prefers '
  + 'short, direct answers.'

const draft = shallowRef<string>(props.settings.aboutMe ?? '')
const isSaving = shallowRef<boolean>(false)
const saveError = shallowRef<MemorySaveError | null>(null)

const { textarea } = useTextareaAutosize({ input: draft })

const isOverLimit = computed<boolean>(() => {
  return draft.value.length > MEMORY_LIMITS.maxAboutMeChars
})

const isUnchanged = computed<boolean>(() => {
  return draft.value.trim() === (props.settings.aboutMe ?? '')
})

const isSaveDisabled = computed<boolean>(() => {
  return isSaving.value || isOverLimit.value || isUnchanged.value
})

function clearDraft() {
  draft.value = ''
  saveError.value = null
}

async function saveAboutMe() {
  isSaving.value = true
  saveError.value = null

  const outcome = await props.save({ aboutMe: draft.value.trim() })

  isSaving.value = false

  if (!outcome.ok) {
    saveError.value = outcome.parsed

    return
  }

  draft.value = draft.value.trim()

  useInfoMessage('Saved', 'About me updated.')
}
</script>
