<template>
  <article
    v-if="view"
    class="mt-2 w-full max-w-md rounded-box border border-base-300 bg-base-200"
    :data-state="cardState"
    :data-format="view.format"
    :aria-label="`${formatLabel} ${titleText}`"
    data-testid="document-card"
  >
    <div class="flex items-center gap-3 p-3">
      <span class="grid size-10 shrink-0 place-items-center rounded-field bg-base-100 text-base-content/70">
        <Icon
          :name="formatIcon"
          size="22"
          aria-hidden="true"
        />
      </span>
      <div class="min-w-0 grow">
        <p
          class="truncate text-sm font-medium"
          :title="titleText"
          data-testid="document-card-title"
        >
          {{ titleText }}
        </p>
        <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/60">
          <span
            class="badge badge-soft badge-sm"
            data-testid="document-card-format"
          >
            {{ formatLabel }}
          </span>
          <span
            v-if="metaLabel"
            data-testid="document-card-meta"
          >
            {{ metaLabel }}
          </span>
        </div>
      </div>
    </div>
    <div class="grid gap-2 px-3 pb-3">
      <p
        role="status"
        aria-live="polite"
        class="flex items-center gap-2 text-xs text-base-content/70"
        data-testid="document-card-status"
      >
        <Icon
          v-if="statusIcon"
          :name="statusIcon"
          size="14"
          class="shrink-0"
          :class="{ 'motion-safe:animate-spin': isWorking }"
          aria-hidden="true"
        />
        <span>{{ statusText }}</span>
      </p>
      <div
        v-if="cardState === 'streaming'"
        class="skeleton skeleton--default h-2 w-full"
        aria-hidden="true"
        data-testid="document-card-skeleton"
      />
      <div
        v-if="cardState === 'failed'"
        class="alert alert-error alert-soft items-start"
        data-testid="document-card-error"
      >
        <Icon
          name="lucide:circle-alert"
          size="16"
          class="shrink-0"
          aria-hidden="true"
        />
        <p class="text-sm">{{ failureText }}</p>
        <button
          v-if="canRetry"
          type="button"
          class="btn btn-sm"
          :disabled="isBusy"
          data-testid="document-card-retry"
          @click="onRetry"
        >
          Try again
        </button>
      </div>
    </div>
    <div
      v-if="hasActions"
      class="flex flex-wrap items-center gap-2 border-t border-base-300 p-2"
      data-testid="document-card-actions"
    >
      <button
        v-if="canPreview"
        type="button"
        class="btn btn-sm btn-soft"
        :aria-expanded="isPanelOpen"
        :aria-label="`Preview ${titleText}`"
        data-testid="document-card-preview"
        @click="onPreview"
      >
        <Icon
          name="lucide:eye"
          size="16"
          aria-hidden="true"
        />
        Preview
      </button>
      <a
        :href="downloadUrl"
        download
        class="btn btn-sm btn-accent"
        :aria-label="`Download ${titleText}`"
        data-testid="document-card-download"
      >
        <Icon
          name="lucide:download"
          size="16"
          aria-hidden="true"
        />
        Download
      </a>
      <slot name="extraActions" />
    </div>
  </article>
</template>

<script setup lang="ts">
import { LazyChatDocumentPreview } from '#components'
import { DOCUMENT_FORMAT_LABELS } from '#shared/utils/documents'
import type { DocumentFormat } from '#shared/utils/documents'

type CardState
  = | 'streaming'
    | 'building'
    | 'ready'
    | 'failed'
    | 'unavailable'
    | 'shared'

const props = withDefaults(defineProps<{
  part: unknown
  isStreaming?: boolean
  modelId?: string
}>(), {
  isStreaming: false,
  modelId: undefined,
})

const sidePanel = useSidePanel()
const documentsFeature = useFeature('documents')

const view = computed(() => {
  return isDocumentPart(props.part) ? getDocumentPartView(props.part) : null
})

const flowDocumentId = computed<string | null>(() => {
  const current = view.value

  if (current?.state !== 'ready-to-render' && current?.state !== 'failed') {
    return null
  }

  return current.documentId
})

const flow = useDocumentFlow(flowDocumentId, {
  isStreaming: () => props.isStreaming,
  modelId: () => props.modelId,
})

const isOwnerDocument = computed<boolean>(() => {
  return flowDocumentId.value !== null
})

const flowFile = computed(() => {
  return flow.document.value?.file ?? null
})

const isFlowReady = computed<boolean>(() => {
  return flow.status.value === 'ready' && flowFile.value !== null
})

const cardState = computed<CardState>(() => {
  const current = view.value

  if (!current) {
    return 'unavailable'
  }

  if (current.state === 'streaming') {
    return 'streaming'
  }

  if (current.state === 'creating') {
    return 'building'
  }

  if (!isOwnerDocument.value) {
    return current.state === 'failed' ? 'failed' : 'shared'
  }

  if (!documentsFeature.value.active) {
    return 'unavailable'
  }

  if (flow.status.value === 'failed') {
    return 'failed'
  }

  if (flow.status.value === 'unavailable') {
    return 'unavailable'
  }

  if (flow.status.value === 'ready') {
    return isFlowReady.value ? 'ready' : 'unavailable'
  }

  return 'building'
})

const format = computed<DocumentFormat | null>(() => {
  return view.value?.format ?? null
})

const formatLabel = computed<string>(() => {
  return format.value ? DOCUMENT_FORMAT_LABELS[format.value] : 'Document'
})

const formatIcon = computed<string>(() => {
  return format.value ? DOCUMENT_FORMAT_ICONS[format.value] : 'lucide:file'
})

const titleText = computed<string>(() => {
  return flow.document.value?.title || view.value?.title || 'Document'
})

const sharedFile = computed(() => {
  return readSharedDocumentFile(props.part)
})

const metaLabel = computed<string>(() => {
  const current = view.value

  if (!current?.format) {
    return ''
  }

  if (cardState.value === 'shared') {
    return getDocumentMetaLabel(current.format, null, sharedFile.value?.size)
  }

  if (cardState.value === 'streaming') {
    return current.blockCount > 0
      ? `${current.blockCount} ${current.blockCount === 1 ? 'block' : 'blocks'}`
      : ''
  }

  return getDocumentMetaLabel(
    current.format,
    flow.document.value?.stats,
    flowFile.value?.size,
  )
})

const isWorking = computed<boolean>(() => {
  return cardState.value === 'streaming' || cardState.value === 'building'
})

const statusText = computed<string>(() => {
  switch (cardState.value) {
    case 'streaming':
      return 'Writing the outline...'
    case 'building':
      return `Building ${formatLabel.value}...`
    case 'ready':
      return 'Ready'
    case 'failed':
      return 'Document could not be created'
    case 'unavailable':
      return 'Document unavailable'
    default:
      return sharedFile.value ? 'Shared document' : 'Document in this chat'
  }
})

const statusIcon = computed<string>(() => {
  switch (cardState.value) {
    case 'streaming':
    case 'building':
      return 'lucide:loader-circle'
    case 'ready':
      return 'lucide:check'
    case 'failed':
      return 'lucide:circle-alert'
    case 'unavailable':
      return 'lucide:file-x'
    default:
      return ''
  }
})

const failureText = computed<string>(() => {
  return flow.errorMessage.value
    || view.value?.errorText
    || view.value?.errorTitle
    || 'Something went wrong while creating this document.'
})

const canRetry = computed<boolean>(() => {
  return isOwnerDocument.value
    && documentsFeature.value.active
    && isDocumentErrorRetryable(flow.document.value?.errorCode ?? null)
})

const isBusy = computed<boolean>(() => {
  return flow.isBusy.value
})

const fileUrls = computed(() => {
  return flowFile.value ? getDocumentFileUrls(flowFile.value) : null
})

const downloadUrl = computed<string>(() => {
  if (cardState.value === 'shared') {
    return sharedFile.value?.url ?? ''
  }

  return fileUrls.value?.downloadUrl ?? ''
})

const canPreview = computed<boolean>(() => {
  return cardState.value === 'ready'
})

const hasActions = computed<boolean>(() => {
  if (cardState.value === 'ready') {
    return true
  }

  return cardState.value === 'shared' && !!sharedFile.value
})

const panelViewKey = computed<string>(() => {
  return `document:${flowDocumentId.value ?? ''}`
})

const isPanelOpen = computed<boolean>(() => {
  return sidePanel.isOpen.value
    && sidePanel.viewKey.value === panelViewKey.value
})

function onPreview() {
  const documentId = flowDocumentId.value
  const current = view.value

  if (!documentId || !current?.format || !fileUrls.value) {
    return
  }

  sidePanel.open({
    viewKey: panelViewKey.value,
    title: titleText.value,
    mode: 'detail',
    component: LazyChatDocumentPreview,
    props: {
      documentId,
      format: current.format,
      title: titleText.value,
      viewUrl: fileUrls.value.viewUrl,
      downloadUrl: fileUrls.value.downloadUrl,
    },
  })
}

async function onRetry() {
  await flow.retry()
}
</script>
