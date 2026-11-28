<template>
  <article
    v-if="file"
    class="mt-2 w-full max-w-md rounded-box border border-base-300 bg-base-200"
    :data-kind="file.kind"
    :aria-label="`${typeLabel} ${file.title}`"
    data-testid="google-file-card"
  >
    <button
      type="button"
      class="flex w-full items-center gap-3 rounded-t-box p-3 text-left cursor-pointer transition-colors duration-150 hover:bg-base-300/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      :aria-expanded="isPanelOpen"
      :aria-label="`Preview ${file.title}`"
      data-testid="google-file-card-preview"
      @click="onPreview"
    >
      <span class="grid size-10 shrink-0 place-items-center rounded-field bg-base-100">
        <Icon
          :name="GOOGLE_FILE_KIND_ICONS[file.kind]"
          size="22"
          aria-hidden="true"
          data-testid="google-file-card-icon"
        />
      </span>
      <span class="min-w-0 grow">
        <span
          class="block truncate text-sm font-medium"
          :title="file.title"
          data-testid="google-file-card-title"
        >
          {{ file.title }}
        </span>
        <span class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/60">
          <span
            class="badge badge-soft badge-sm"
            data-testid="google-file-card-type"
          >
            {{ badgeLabel }}
          </span>
          <span data-testid="google-file-card-meta">
            in your Google Drive
          </span>
        </span>
      </span>
    </button>
    <div
      class="flex flex-wrap items-center gap-2 border-t border-base-300 p-2"
      data-testid="google-file-card-actions"
    >
      <a
        :href="file.openLink"
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-sm btn-soft"
        data-testid="google-file-card-open"
      >
        <Icon
          name="lucide:external-link"
          size="16"
          aria-hidden="true"
        />
        {{ openLabel }}
        <span class="sr-only">(opens in a new tab)</span>
      </a>
    </div>
  </article>
</template>

<script setup lang="ts">
import {
  GOOGLE_FILE_KIND_ICONS,
  GOOGLE_FILE_KIND_LABELS,
  GOOGLE_FILE_KIND_TYPE_LABELS,
  readGoogleCreatedFile,
} from '#shared/utils/google-created-file'

const props = defineProps<{
  part: unknown
}>()

const { register, unregister, isShowing, open } = useGoogleFilePreview()
const { routeSlug } = useChatRoute()

const file = computed(() => {
  return readGoogleCreatedFile(props.part)
})

const previewTarget = computed(() => {
  return file.value
    ? { ...file.value, chatSlug: routeSlug.value }
    : null
})

const typeLabel = computed<string>(() => {
  return file.value ? GOOGLE_FILE_KIND_TYPE_LABELS[file.value.kind] : ''
})

const badgeLabel = computed<string>(() => {
  if (!file.value) {
    return ''
  }

  return file.value.kind === 'text'
    ? typeLabel.value
    : GOOGLE_FILE_KIND_LABELS[file.value.kind]
})

const openLabel = computed<string>(() => {
  return file.value
    ? `Open in ${GOOGLE_FILE_KIND_LABELS[file.value.kind]}`
    : ''
})

const isPanelOpen = computed<boolean>(() => {
  return file.value ? isShowing(file.value.toolCallId) : false
})

watch(previewTarget, (current, previous) => {
  if (!import.meta.client) {
    return
  }

  if (previous && previous.toolCallId !== current?.toolCallId) {
    unregister(previous.toolCallId)
  }

  if (current) {
    register(current)
  }
}, { immediate: true })

onBeforeUnmount(() => {
  if (file.value) {
    unregister(file.value.toolCallId)
  }
})

function onPreview() {
  if (!previewTarget.value) {
    return
  }

  open(previewTarget.value)
}
</script>
