<template>
  <a
    :href="openLink"
    target="_blank"
    rel="noopener noreferrer"
    class="btn btn-sm btn-soft max-w-44 shrink"
    :title="openLabel"
    :aria-label="`${openLabel} (opens in a new tab)`"
    data-testid="google-file-open"
  >
    <Icon
      name="lucide:external-link"
      size="16"
      aria-hidden="true"
    />
    <span class="truncate">{{ openLabel }}</span>
  </a>
</template>

<script setup lang="ts">
import { GOOGLE_FILE_KIND_LABELS } from '#shared/utils/google-created-file'
import type { GoogleCreatedFileKind } from '#shared/utils/google-created-file'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  kind: GoogleCreatedFileKind
  openLink: string
}>()

const openLabel = computed<string>(() => {
  return `Open in ${GOOGLE_FILE_KIND_LABELS[props.kind]}`
})
</script>
