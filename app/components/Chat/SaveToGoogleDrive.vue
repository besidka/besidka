<template>
  <span class="contents">
    <a
      v-if="isAvailable && saved"
      ref="openLink"
      :href="saved.link"
      target="_blank"
      rel="noopener noreferrer"
      :class="classes"
      :aria-label="`Open ${fileName} in Google Drive`"
      :title="`Open ${fileName} in Google Drive`"
      data-testid="save-to-google-drive-open"
    >
      <Icon
        :name="GOOGLE_DRIVE_ICON"
        :size="iconSize"
        aria-hidden="true"
      />
      <span v-if="variant === 'button'">Open in Google Drive</span>
    </a>
    <button
      v-else-if="isAvailable"
      ref="saveButton"
      type="button"
      :class="classes"
      :disabled="isSaving"
      :aria-busy="isSaving"
      :aria-label="`Save ${fileName} to Google Drive`"
      :title="isSaving ? 'Saving to Google Drive' : 'Save to Google Drive'"
      data-testid="save-to-google-drive"
      @click="onSave"
    >
      <span
        v-if="isSaving"
        class="loading loading-spinner"
        :class="variant === 'button' ? 'size-4' : 'size-3'"
        aria-hidden="true"
      />
      <Icon
        v-else
        :name="GOOGLE_DRIVE_ICON"
        :size="iconSize"
        aria-hidden="true"
      />
      <span v-if="variant === 'button'">
        {{ isSaving ? 'Saving to Google Drive' : 'Save to Google Drive' }}
      </span>
    </button>
    <span
      class="sr-only"
      role="status"
      aria-live="polite"
      data-testid="save-to-google-drive-status"
    >{{ statusText }}</span>
  </span>
</template>

<script setup lang="ts">
import { GOOGLE_DRIVE_ICON } from '#shared/utils/google-brand-icons'

const props = withDefaults(defineProps<{
  storageKey: string
  fileName: string
  variant?: 'icon' | 'button'
}>(), {
  variant: 'icon',
})

const { isAvailable, getSaved, save } = useGoogleDriveSave()

const isSaving = shallowRef<boolean>(false)
const statusText = shallowRef<string>('')
const saveButton = useTemplateRef<HTMLButtonElement>('saveButton')
const openLink = useTemplateRef<HTMLAnchorElement>('openLink')

const saved = computed(() => {
  return getSaved(props.storageKey)
})

const classes = computed<string>(() => {
  return props.variant === 'button'
    ? 'btn btn-sm btn-soft'
    : 'btn btn-circle btn-xs btn-soft'
})

const iconSize = computed<number>(() => {
  return props.variant === 'button' ? 16 : 12
})

async function onSave() {
  if (isSaving.value) {
    return
  }

  const hadFocus = document.activeElement === saveButton.value

  isSaving.value = true
  statusText.value = 'Saving to Google Drive'

  try {
    const result = await save(props.storageKey)

    statusText.value = result
      ? `${props.fileName} was saved to Google Drive`
      : `${props.fileName} could not be saved to Google Drive`
  } finally {
    isSaving.value = false
  }

  if (hadFocus) {
    await nextTick()

    const focusTarget = openLink.value ?? saveButton.value

    focusTarget?.focus()
  }
}
</script>
