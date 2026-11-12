<template>
  <HistoryPageShell active-tab="documents">
    <template #title>
      Documents
    </template>
    <template #subtitle>
      PDF, Word, PowerPoint and Excel files your chats and connected apps made
    </template>

    <template #toolbar>
      <div class="flex shrink-0 flex-col gap-3">
        <UiSearchInput
          v-model="search"
          :is-searching="isRefreshing"
          placeholder="Search documents..."
          class="input-sm sm:input-md"
        />
        <HistoryBoxTabs
          :options="sourceOptions"
          :model-value="appliedSource"
          label="Filter by source"
          test-id-prefix="document-library-source"
          @select="onSelectSource"
        />
        <HistoryFilterButtons
          :options="formatOptions"
          :model-value="appliedFormat"
          label="Filter by format"
          test-id-prefix="document-library-format"
          @select="onSelectFormat"
        />
      </div>
    </template>

    <div
      v-if="hasError"
      class="alert alert-error alert-soft items-start"
      role="alert"
      data-testid="document-library-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="18"
        class="shrink-0"
        aria-hidden="true"
      />
      <div class="grow">
        <p class="font-medium">
          Couldn't load your documents
        </p>
        <p class="text-sm">
          {{ errorMessage }}
        </p>
      </div>
      <button
        type="button"
        class="btn btn-sm"
        data-testid="document-library-retry"
        @click="refresh()"
      >
        Retry
      </button>
    </div>

    <div
      v-else-if="isSkeletonVisible"
      class="flex flex-col gap-2"
      aria-hidden="true"
      data-testid="document-library-skeleton"
    >
      <div
        v-for="index in DOCUMENT_LIBRARY_SKELETON_ROWS"
        :key="index"
        class="flex items-center gap-3 rounded-box border border-base-200/70 px-3 py-3"
      >
        <div class="skeleton skeleton--default size-10 shrink-0 rounded-field" />
        <div class="flex-1 space-y-2">
          <div class="skeleton skeleton--default h-4 w-2/3 rounded-full" />
          <div class="skeleton skeleton--default h-3 w-1/2 rounded-full" />
        </div>
        <div class="skeleton skeleton--default h-8 w-8 shrink-0 rounded-full" />
      </div>
    </div>

    <ul
      v-else-if="items.length"
      class="list"
      data-testid="document-library-list"
    >
      <HistoryDocumentRow
        v-for="item in items"
        :key="item.id"
        :item="item"
        @preview="onPreview"
        @rename="onRename"
        @delete="onDelete"
      />
    </ul>

    <div
      v-else-if="hasLoaded && !hasMore && isFiltered"
      class="rounded-box border border-dashed border-base-300 px-6 py-12 text-center"
      data-testid="document-library-no-results"
    >
      <Icon
        name="lucide:search-x"
        size="40"
        class="mx-auto mb-3 opacity-60"
      />
      <p class="font-medium">
        {{ noResultsText }}
      </p>
      <button
        type="button"
        class="btn btn-sm mt-4"
        data-testid="document-library-clear"
        @click="onClearFilters"
      >
        Clear
      </button>
    </div>

    <div
      v-else-if="hasLoaded && !hasMore"
      class="rounded-box border border-dashed border-base-300 px-6 py-12 text-center"
      data-testid="document-library-empty"
    >
      <Icon
        name="lucide:file-text"
        size="40"
        class="mx-auto mb-3 opacity-60"
      />
      <p class="font-medium">
        No documents yet
      </p>
      <p class="mt-2 mb-4 text-sm text-base-content/70">
        Ask for a report, a deck or a spreadsheet in any chat
      </p>
      <NuxtLink
        to="/chats/new"
        class="btn btn-primary btn-sm"
      >
        New chat
      </NuxtLink>
    </div>

    <div
      v-if="hasMore && !hasError"
      class="flex justify-center py-2"
    >
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        :disabled="isLoadingMore || isMutating"
        data-testid="document-library-load-more"
        @click="loadMore"
      >
        <span
          v-if="isLoadingMore"
          class="loading loading-spinner loading-xs"
        />
        Load more
      </button>
    </div>
  </HistoryPageShell>

  <ChatInputFilesModalSelectRenameModal
    ref="renameModalRef"
    @submit="onRenameSubmit"
  />
</template>

<script setup lang="ts">
import type { DocumentLibraryItem } from '#shared/utils/documents'

definePageMeta({
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Documents',
})

const documentsFeature = useFeature('documents')
const preview = useDocumentPreview()

if (!documentsFeature.value.active) {
  await navigateTo('/chats/history', { replace: true })
}

const {
  search,
  appliedQuery,
  appliedFormat,
  appliedSource,
  setFormat,
  setSource,
  clearFilters,
} = useDocumentLibraryFilters()

const {
  items,
  formatCounts,
  sourceCounts,
  hasMore,
  hasError,
  hasLoaded,
  errorMessage,
  isRefreshing,
  isSkeletonVisible,
  isLoadingMore,
  isMutating,
  refresh,
  loadMore,
  deleteDocument,
  renameDocument,
} = useDocumentLibrary({
  query: appliedQuery,
  format: appliedFormat,
  source: appliedSource,
})

const renameModalRef = shallowRef<{
  open: (file: { id: string, name: string }) => void
  close: () => void
} | null>(null)
const renameTarget = shallowRef<DocumentLibraryItem | null>(null)

const formatOptions = computed(() => {
  return buildDocumentFormatOptions(formatCounts.value)
})

const sourceOptions = computed(() => {
  return buildDocumentSourceOptions(sourceCounts.value)
})

const isFiltered = computed<boolean>(() => {
  return !!appliedQuery.value
    || appliedFormat.value !== 'all'
    || appliedSource.value !== 'all'
})

const noResultsText = computed<string>(() => {
  if (appliedQuery.value) {
    return `Nothing matches "${appliedQuery.value}"`
  }

  return 'No documents here'
})

watch(
  () => [formatCounts.value, appliedFormat.value] as const,
  async ([counts, format]) => {
    if (resolveDocumentFilter(format, counts) !== format) {
      await setFormat('all', { replace: true })
    }
  },
  { immediate: true },
)

watch(
  () => [sourceCounts.value, appliedSource.value] as const,
  async ([counts, source]) => {
    if (resolveDocumentFilter(source, counts) !== source) {
      await setSource('all', { replace: true })
    }
  },
  { immediate: true },
)

async function onSelectFormat(value: string) {
  await setFormat(parseDocumentFormatFilter(value))
}

async function onSelectSource(value: string) {
  await setSource(parseDocumentSourceFilter(value))
}

async function onClearFilters() {
  await clearFilters()
}

function onPreview(item: DocumentLibraryItem) {
  preview.open({
    documentId: item.id,
    format: item.format,
    title: item.title,
    storageKey: item.storageKey,
  })
}

function onRename(item: DocumentLibraryItem) {
  renameTarget.value = item
  renameModalRef.value?.open({ id: item.fileId, name: item.fileName })
}

async function onRenameSubmit(_fileId: string, name: string) {
  const target = renameTarget.value

  if (target) {
    await renameDocument(target, name)
  }

  renameTarget.value = null
  renameModalRef.value?.close()
}

async function onDelete(item: DocumentLibraryItem) {
  const confirmation = await useConfirm({
    text: `Delete "${item.title}"?`,
    subtitle: 'Deletes the document file. This cannot be undone.',
    alert: true,
    actions: ['Delete'],
  })

  if (!confirmation) {
    return
  }

  const isDeleted = await deleteDocument(item)

  if (isDeleted) {
    preview.closeIfShowing(item.id)
  }
}
</script>
