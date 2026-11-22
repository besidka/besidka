<template>
  <a
    v-if="isAvailable && saved"
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
</template>

<script setup lang="ts">
import { GOOGLE_DRIVE_ICON } from '#shared/utils/google-drive'

const props = withDefaults(defineProps<{
  storageKey: string
  fileName: string
  variant?: 'icon' | 'button'
}>(), {
  variant: 'icon',
})

const { isAvailable, getSaved, save } = useGoogleDriveSave()

const isSaving = shallowRef<boolean>(false)

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

  isSaving.value = true

  try {
    await save(props.storageKey)
  } finally {
    isSaving.value = false
  }
}
</script>
