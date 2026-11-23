<template>
  <ChatInputFilesAttachedChipShell
    :data-drive-import-id="item.id"
    role="group"
    tabindex="-1"
    :aria-label="groupLabel"
    class="outline-none"
    data-testid="drive-import-item"
  >
    <ChatInputFilesAttachedChipPreviewBox>
      <Icon
        :name="GOOGLE_DRIVE_ICON"
        size="20"
      />
    </ChatInputFilesAttachedChipPreviewBox>
    <div class="flex flex-col gap-1 min-w-0 max-w-40">
      <p
        class="pr-2 text-xs font-medium truncate"
        :title="item.name"
      >
        {{ truncateFilename(item.name) }}
      </p>
      <span
        v-if="item.status === 'importing'"
        class="text-[10px] flex items-center gap-0.5 text-base-content/60"
        data-testid="drive-import-status"
      >
        <Icon
          name="lucide:loader-circle"
          size="10"
          class="text-info animate-spin"
        />
        Copying
      </span>
      <button
        v-else
        type="button"
        class="js-drive-import-error flex min-h-6 items-center gap-0.5 rounded-sm text-left text-[10px] text-error outline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-error"
        :aria-expanded="isNoteOpen"
        :aria-controls="noteId"
        :aria-label="`${item.name}: could not import. Show why`"
        :title="item.error"
        data-testid="drive-import-error"
        @click="emit('toggle-note')"
      >
        <Icon
          name="lucide:circle-alert"
          size="10"
          class="shrink-0"
        />
        Could not import
        <Icon
          :name="isNoteOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'"
          size="10"
          class="shrink-0"
        />
      </button>
    </div>
    <progress
      v-if="item.status === 'importing'"
      class="progress progress-info w-full h-1 absolute bottom-0 left-0 rounded-none rounded-b-box"
      :aria-label="`${item.name}, copying from ${GOOGLE_DRIVE_BRAND_NAME}`"
    />
    <template #outside>
      <button
        v-if="item.status === 'failed'"
        class="absolute top-1 right-1 btn btn-circle btn-xs btn-error btn-soft size-4"
        :aria-label="`Dismiss ${item.name}`"
        title="Dismiss"
        data-testid="drive-import-dismiss"
        @click="emit('dismiss')"
      >
        <Icon
          name="lucide:x"
          size="10"
        />
      </button>
    </template>
  </ChatInputFilesAttachedChipShell>
</template>

<script setup lang="ts">
import { GOOGLE_DRIVE_ICON } from '#shared/utils/google-brand-icons'
import { GOOGLE_DRIVE_BRAND_NAME } from '#shared/utils/google-drive'
import type { DriveImportProgress } from '~/composables/chat-drive-files'

const props = defineProps<{
  item: DriveImportProgress
  noteId: string
  isNoteOpen: boolean
}>()

const emit = defineEmits<{
  'toggle-note': []
  'dismiss': []
}>()

const groupLabel = computed<string>(() => {
  return props.item.status === 'importing'
    ? `${props.item.name}, copying from ${GOOGLE_DRIVE_BRAND_NAME}`
    : `${props.item.name} could not be attached`
})
</script>
