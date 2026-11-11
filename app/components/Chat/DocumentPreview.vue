<template>
  <article
    class="grid grid-cols-[minmax(0,1fr)] gap-4 py-4 text-sm"
    :data-format="format"
    data-testid="document-preview"
  >
    <header class="grid gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="badge badge-soft badge-sm"
          data-testid="document-preview-format"
        >
          {{ formatLabel }}
        </span>
        <h3
          class="min-w-0 grow text-base font-semibold leading-snug break-words"
          data-testid="document-preview-title"
        >
          {{ title }}
        </h3>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <a
          v-if="downloadHref"
          :href="downloadHref"
          download
          class="btn btn-sm btn-accent"
          :aria-label="`Download ${title}`"
          data-testid="document-preview-download"
        >
          <Icon
            name="lucide:download"
            size="16"
            aria-hidden="true"
          />
          Download
        </a>
        <a
          v-if="format === 'pdf' && viewHref"
          :href="viewHref"
          target="_blank"
          rel="noopener"
          class="btn btn-sm btn-soft"
          data-testid="document-preview-new-tab"
        >
          <Icon
            name="lucide:external-link"
            size="16"
            aria-hidden="true"
          />
          Open in a new tab
          <span class="sr-only">(opens in a new tab)</span>
        </a>
        <slot name="header-actions" />
      </div>
    </header>
    <p
      v-if="format !== 'pdf'"
      class="text-xs text-base-content/60"
      data-testid="document-preview-note"
    >
      Preview from the document outline; download for exact layout
    </p>
    <div
      v-if="isLoading"
      class="grid gap-2"
      role="status"
      aria-live="polite"
      data-testid="document-preview-loading"
    >
      <span class="sr-only">Loading preview</span>
      <div class="skeleton skeleton--default h-6 w-2/3" />
      <div class="skeleton skeleton--default h-40 w-full" />
      <div class="skeleton skeleton--default h-4 w-1/2" />
    </div>
    <div
      v-else-if="errorText"
      class="alert alert-error alert-soft items-start"
      role="alert"
      data-testid="document-preview-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="18"
        class="shrink-0"
        aria-hidden="true"
      />
      <div class="grow">
        <p class="font-medium">Couldn't load this preview</p>
        <p class="text-sm">{{ errorText }}</p>
      </div>
      <button
        type="button"
        class="btn btn-sm"
        data-testid="document-preview-retry"
        @click="onRetry"
      >
        Try again
      </button>
    </div>
    <iframe
      v-else-if="format === 'pdf' && viewHref"
      :src="viewHref"
      :title="`${title} PDF preview`"
      class="h-[70vh] w-full rounded-box border border-base-300 bg-base-100"
      loading="lazy"
      data-testid="document-preview-pdf"
    />
    <ChatDocumentBlocks
      v-else-if="spec?.format === 'docx'"
      :blocks="spec.blocks"
      data-testid="document-preview-outline"
    />
    <div
      v-else-if="spec?.format === 'pptx'"
      class="grid gap-4"
      data-testid="document-preview-slides"
    >
      <ChatDocumentSlide
        v-for="(slide, slideIndex) in spec.slides"
        :key="`slide-${slideIndex}`"
        :slide="slide"
        :position="slideIndex + 1"
        :total="spec.slides.length"
      />
    </div>
    <ChatDocumentSheets
      v-else-if="spec?.format === 'xlsx'"
      :sheets="spec.sheets"
      data-testid="document-preview-sheets"
    />
  </article>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type { DocumentSpec } from '@besidka/doc-renderer/spec'
import {
  DOCUMENT_FORMAT_LABELS,
  isDocumentFormat,
} from '#shared/utils/documents'
import type {
  DocumentFormat,
  DocumentStatusResponse,
} from '#shared/utils/documents'

const props = defineProps<{
  documentId: string
  format: DocumentFormat
  title: string
  viewUrl?: string
  downloadUrl?: string
}>()

const needsFileUrls = computed<boolean>(() => {
  return !props.viewUrl || !props.downloadUrl
})

const needsSpec = computed<boolean>(() => {
  return props.format !== 'pdf'
})

const {
  data: statusData,
  status: statusRequest,
  error: statusError,
  refresh: refreshStatus,
} = useLazyFetch(
  () => `/api/v1/documents/${encodeURIComponent(props.documentId)}`,
  {
    key: `document-preview-status:${props.documentId}`,
    server: false,
    immediate: needsFileUrls.value,
  },
)

const {
  data: specData,
  status: specRequest,
  error: specError,
  refresh: refreshSpec,
} = useLazyFetch(
  () => `/api/v1/documents/${encodeURIComponent(props.documentId)}/spec`,
  {
    key: `document-preview-spec:${props.documentId}`,
    server: false,
    immediate: needsSpec.value,
  },
)

const formatLabel = computed<string>(() => {
  return DOCUMENT_FORMAT_LABELS[props.format]
})

const fileUrls = computed(() => {
  const file = (statusData.value as DocumentStatusResponse | null)?.file

  return file ? getDocumentFileUrls(file) : null
})

const viewHref = computed<string>(() => {
  return props.viewUrl || fileUrls.value?.viewUrl || ''
})

const downloadHref = computed<string>(() => {
  return props.downloadUrl || fileUrls.value?.downloadUrl || ''
})

const spec = computed<DocumentSpec | null>(() => {
  const candidate = specData.value as { format?: unknown } | null

  if (!candidate || !isDocumentFormat(candidate.format)) {
    return null
  }

  return candidate.format === props.format
    ? candidate as DocumentSpec
    : null
})

const isLoading = computed<boolean>(() => {
  if (props.format === 'pdf') {
    return needsFileUrls.value
      && !viewHref.value
      && statusRequest.value === 'pending'
  }

  if (spec.value || specError.value) {
    return false
  }

  return specRequest.value === 'idle' || specRequest.value === 'pending'
})

const errorText = computed<string>(() => {
  const failure = props.format === 'pdf'
    ? statusError.value
    : specError.value

  if (failure) {
    return parseError(failure).message || 'Please try again.'
  }

  if (props.format === 'pdf') {
    return !viewHref.value && !isLoading.value
      ? 'The file is no longer available.'
      : ''
  }

  return !spec.value && !isLoading.value
    ? 'The document outline is not available.'
    : ''
})

async function onRetry() {
  if (props.format === 'pdf') {
    await refreshStatus()

    return
  }

  await refreshSpec()
}
</script>
