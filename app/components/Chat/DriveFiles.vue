<template>
  <ul
    v-if="references.length"
    class="mb-2 flex flex-wrap gap-1.5"
    aria-label="Google Drive files"
    data-testid="message-drive-files"
  >
    <li
      v-for="reference in references"
      :key="reference.key"
      class="flex max-w-full items-center gap-2 rounded-box border border-base-300 bg-base-200 py-1.5 pr-3 pl-2 text-sm"
      data-testid="message-drive-file"
    >
      <span
        class="grid size-6 shrink-0 place-items-center rounded-field bg-base-100 text-base-content/70"
        role="img"
        :aria-label="GOOGLE_DRIVE_BRAND_NAME"
      >
        <Icon
          :name="GOOGLE_DRIVE_ICON"
          size="14"
        />
      </span>
      <span
        class="min-w-0 truncate font-medium"
        :title="reference.name"
      >
        {{ reference.name }}
      </span>
      <a
        v-if="reference.link"
        :href="reference.link"
        target="_blank"
        rel="noopener noreferrer"
        class="link link-accent shrink-0 text-xs"
        :aria-label="`Open ${reference.name} in ${GOOGLE_DRIVE_BRAND_NAME}`"
        data-testid="message-drive-file-link"
      >
        Open in {{ GOOGLE_DRIVE_BRAND_NAME }}
      </a>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import {
  GOOGLE_DRIVE_BRAND_NAME,
  GOOGLE_DRIVE_ICON,
  isDriveFileReference,
} from '#shared/utils/google-drive'

const DRIVE_LINK_PREFIX = 'https://drive.google.com/'

interface DriveFileReference {
  key: string
  name: string
  link: string | null
}

const props = defineProps<{
  message: Pick<UIMessage, 'role' | 'parts'>
}>()

const references = computed<DriveFileReference[]>(() => {
  if (props.message.role !== 'user') {
    return []
  }

  return props.message.parts.flatMap((part, index) => {
    if (!isDriveFileReference(part) || !part.data.name) {
      return []
    }

    return [{
      key: `${part.data.driveFileId}:${index}`,
      name: part.data.name,
      link: part.data.link.startsWith(DRIVE_LINK_PREFIX)
        ? part.data.link
        : null,
    }]
  })
})
</script>
