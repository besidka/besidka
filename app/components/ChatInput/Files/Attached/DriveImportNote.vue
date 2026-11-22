<template>
  <div
    :id="id"
    ref="note"
    tabindex="-1"
    class="mt-1 rounded-box bg-base-200 p-2 text-xs outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
    role="region"
    :aria-label="`Why ${item.name} could not be imported`"
    data-testid="drive-import-note"
    @keydown.esc.stop="emit('close')"
  >
    <p
      class="break-words"
      data-testid="drive-import-note-text"
    >
      {{ item.error || 'This file could not be imported.' }}
    </p>
    <p
      v-if="item.detail"
      class="mt-1 break-all text-[10px] text-base-content/60"
      data-testid="drive-import-note-detail"
    >
      ({{ item.detail }})
    </p>
    <div class="mt-2 flex flex-wrap gap-2">
      <button
        v-if="canPickDriveFileAgain(item.code)"
        type="button"
        class="btn btn-sm btn-soft min-h-11 sm:min-h-8"
        data-testid="drive-import-pick-again"
        @click="emit('pick-again')"
      >
        <Icon
          :name="GOOGLE_DRIVE_ICON"
          size="16"
        />
        Pick again
      </button>
      <button
        type="button"
        class="btn btn-sm btn-ghost min-h-11 sm:min-h-8"
        data-testid="drive-import-remove"
        @click="emit('dismiss')"
      >
        <Icon
          name="lucide:x"
          size="16"
        />
        Remove
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { GOOGLE_DRIVE_ICON } from '#shared/utils/google-brand-icons'
import { canPickDriveFileAgain } from '#shared/utils/google-drive'
import type { DriveImportProgress } from '~/composables/chat-drive-files'

defineProps<{
  id: string
  item: DriveImportProgress
}>()

const emit = defineEmits<{
  'pick-again': []
  'dismiss': []
  'close': []
}>()

const note = useTemplateRef<HTMLElement>('note')

defineExpose({
  focus: () => note.value?.focus(),
})
</script>
