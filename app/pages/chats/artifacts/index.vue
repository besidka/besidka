<template>
  <HistoryPageShell active-tab="artifacts">
    <template #title>
      Artifacts
    </template>
    <template #subtitle>
      Apps, diagrams and documents your chats and connected apps created
    </template>

    <template #toolbar>
      <div class="flex shrink-0 flex-col gap-3">
        <UiSearchInput
          v-model="search"
          :is-searching="isRefreshing"
          placeholder="Search artifacts..."
          class="input-sm sm:input-md"
        />
        <div
          role="group"
          aria-label="Filter by type"
          class="flex flex-wrap gap-1.5"
          data-testid="artifact-library-kind-filter"
        >
          <button
            v-for="option in ARTIFACT_LIBRARY_KIND_FILTERS"
            :key="option.value"
            type="button"
            class="btn btn-sm"
            :class="appliedKind === option.value ? 'btn-accent' : 'btn-soft'"
            :aria-pressed="appliedKind === option.value"
            :data-testid="`artifact-library-kind-${option.value}`"
            @click="setKind(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </template>

    <div
      v-if="notice"
      class="alert alert-warning alert-soft items-start text-sm"
      role="alert"
      data-testid="artifact-library-notice"
    >
      <Icon
        name="lucide:triangle-alert"
        size="16"
        class="mt-0.5 shrink-0"
        aria-hidden="true"
      />
      <span class="grow">{{ notice }}</span>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-circle"
        aria-label="Dismiss"
        data-testid="artifact-library-notice-dismiss"
        @click="notice = ''"
      >
        <Icon
          name="lucide:x"
          size="14"
          aria-hidden="true"
        />
      </button>
    </div>

    <HistoryActionsToolbar
      :selected-count="selectedCount"
      :visible="isSelectionMode"
      :is-deleting="isDeleting"
      :show-move-to-project="false"
      @deselect="deselectAll"
      @delete="onBulkDelete"
    />

    <div
      v-if="hasError"
      class="alert alert-error alert-soft items-start"
      role="alert"
      data-testid="artifact-library-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="18"
        class="shrink-0"
        aria-hidden="true"
      />
      <div class="grow">
        <p class="font-medium">
          Couldn't load your artifacts
        </p>
        <p class="text-sm">
          {{ errorMessage }}
        </p>
      </div>
      <button
        type="button"
        class="btn btn-sm"
        data-testid="artifact-library-retry"
        @click="refresh()"
      >
        Retry
      </button>
    </div>

    <div
      v-else-if="isSkeletonVisible"
      class="flex flex-col gap-2"
      aria-hidden="true"
      data-testid="artifact-library-skeleton"
    >
      <div
        v-for="index in ARTIFACT_LIBRARY_SKELETON_ROWS"
        :key="index"
        class="flex items-center gap-3 rounded-box border border-base-200/70 px-3 py-3"
      >
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
      data-testid="artifact-library-list"
    >
      <HistoryArtifactRow
        v-for="(artifact, index) in items"
        :key="artifact.id"
        :artifact="artifact"
        :index="index"
        :is-selection-mode="isSelectionMode"
        :is-selected="selectedIds.has(artifact.id)"
        :can-share="shareFeature.active"
        @open="onOpen"
        @share="onShare"
        @download="onDownload"
        @delete="onDelete"
        @select="handleSelect"
        @enter-select="enterSelectionMode"
      />
    </ul>

    <div
      v-else-if="hasLoaded && !hasMore && isFiltered"
      class="rounded-box border border-dashed border-base-300 px-6 py-12 text-center"
      data-testid="artifact-library-no-results"
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
        data-testid="artifact-library-clear"
        @click="onClearFilters"
      >
        Clear
      </button>
    </div>

    <div
      v-else-if="hasLoaded && !hasMore"
      class="rounded-box border border-dashed border-base-300 px-6 py-12 text-center"
      data-testid="artifact-library-empty"
    >
      <Icon
        name="lucide:app-window"
        size="40"
        class="mx-auto mb-3 opacity-60"
      />
      <p class="font-medium">
        No artifacts yet
      </p>
      <p class="mt-2 mb-4 text-sm text-base-content/70">
        Ask for a quiz, a diagram or a small app in any chat
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
        :disabled="isLoadingMore || isDeleting"
        data-testid="artifact-library-load-more"
        @click="loadMore"
      >
        <span
          v-if="isLoadingMore"
          class="loading loading-spinner loading-xs"
        />
        Load more
      </button>
    </div>

    <p
      v-if="hasLoaded"
      class="text-center text-xs text-base-content/60"
      data-testid="artifact-library-usage"
    >
      {{ usageText }}
    </p>
  </HistoryPageShell>

  <ChatArtifactShareModal
    v-if="shareTarget"
    :key="shareTarget.id"
    v-model:open="isShareOpen"
    :artifact-id="shareTarget.id"
    :title="shareTarget.title"
    :current-version="shareTarget.currentVersion"
  />
</template>

<script setup lang="ts">
import type { ArtifactSummary } from '#shared/utils/artifacts'

definePageMeta({
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Artifacts',
})

const UNAVAILABLE_NOTICE = 'This artifact is not available'
const TAKEN_DOWN_NOTICE = 'This artifact was removed after a report'
const DELETE_SUBTITLE
  = 'Viewers\' saved progress is deleted too. This cannot be undone.'

const route = useRoute()
const router = useRouter()
const artifactsFeature = useFeature('artifacts')
const shareFeature = useFeature('artifacts.share')
const panel = useArtifactPanel()

if (!artifactsFeature.value.active) {
  await navigateTo('/chats/history', { replace: true })
}

const { search, appliedQuery, appliedKind, setKind, clearFilters }
  = useArtifactLibraryFilters()

const {
  items,
  usedBytes,
  hasMore,
  hasError,
  hasLoaded,
  errorMessage,
  isRefreshing,
  isSkeletonVisible,
  isLoadingMore,
  isDeleting,
  selectedIds,
  selectedCount,
  isSelectionMode,
  refresh,
  refreshItem,
  loadMore,
  deleteArtifacts,
  handleSelect,
  enterSelectionMode,
  deselectAll,
} = useArtifactLibrary({ query: appliedQuery, kind: appliedKind })

const notice = shallowRef<string>('')
const shareTarget = shallowRef<ArtifactSummary | null>(null)
const isShareOpen = shallowRef<boolean>(false)

const isFiltered = computed<boolean>(() => {
  return !!appliedQuery.value || appliedKind.value !== 'all'
})

const noResultsText = computed<string>(() => {
  if (appliedQuery.value) {
    return `Nothing matches "${appliedQuery.value}"`
  }

  return appliedKind.value === 'all'
    ? 'No artifacts here'
    : `No ${ARTIFACT_KIND_LABELS[appliedKind.value]} artifacts`
})

const usageText = computed<string>(() => {
  return formatArtifactUsage(usedBytes.value)
})

watch(isShareOpen, async (open, wasOpen) => {
  if (open || !wasOpen || !shareTarget.value) {
    return
  }

  await refreshItem(shareTarget.value.id)
})

watch(() => route.query.artifact, async (artifactId) => {
  if (import.meta.server || typeof artifactId !== 'string') {
    return
  }

  await openDeepLinkedArtifact(artifactId)
})

onMounted(async () => {
  const artifactId = route.query.artifact

  if (typeof artifactId === 'string') {
    await openDeepLinkedArtifact(artifactId)
  }
})

async function dropDeepLinkParam() {
  const query = { ...route.query }

  delete query.artifact

  await router.replace({ path: route.path, query })
}

async function openDeepLinkedArtifact(artifactId: string) {
  await dropDeepLinkParam()

  if (!isArtifactPublicId(artifactId)) {
    notice.value = UNAVAILABLE_NOTICE

    return
  }

  const result = await loadArtifactDetail(artifactId, { notify: false })

  if (!result.ok) {
    notice.value = result.status === 451
      ? TAKEN_DOWN_NOTICE
      : UNAVAILABLE_NOTICE

    return
  }

  if (result.value.takenDown) {
    notice.value = TAKEN_DOWN_NOTICE

    return
  }

  notice.value = ''
  openInPanel(result.value)
}

function openInPanel(artifact: ArtifactSummary) {
  panel.open({
    artifactId: artifact.id,
    version: artifact.currentVersion,
    kind: artifact.kind,
    title: artifact.title,
    source: 'owner',
  })
}

function onOpen(artifact: ArtifactSummary) {
  openInPanel(artifact)
}

function onShare(artifact: ArtifactSummary) {
  shareTarget.value = artifact
  isShareOpen.value = true
}

async function onDownload(artifact: ArtifactSummary) {
  const result = await loadArtifactVersion({
    artifactId: artifact.id,
    version: artifact.currentVersion,
    source: 'owner',
  })

  if (!result.ok) {
    if (isArtifactUnavailableStatus(result.status)) {
      useErrorMessage(UNAVAILABLE_NOTICE)
    }

    return
  }

  downloadArtifactFile(
    buildArtifactSourceFile(result.value.kind, result.value.content, {
      title: result.value.title,
    }),
  )
}

async function onClearFilters() {
  await clearFilters()
}

function reportDeleteResult(deletedCount: number, heldCount: number) {
  if (deletedCount) {
    useSuccessMessage(
      deletedCount === 1
        ? 'Artifact deleted'
        : `${deletedCount} artifacts deleted`,
    )
  }

  if (heldCount) {
    useWarningMessage(
      heldCount === 1
        ? 'One artifact could not be deleted'
        : `${heldCount} artifacts could not be deleted`,
      'They are on hold after a report and stay until the hold ends.',
    )
  }
}

function closePanelIfShowing(deletedIds: string[]) {
  const openArtifactId = panel.state.value?.artifactId

  if (openArtifactId && deletedIds.includes(openArtifactId)) {
    panel.close()
  }
}

async function confirmAndDelete(
  ids: string[],
  heading: string,
  subtitle: string,
) {
  const confirmation = await useConfirm({
    text: heading,
    subtitle,
    alert: true,
    actions: ['Delete'],
  })

  if (!confirmation) {
    return
  }

  const result = await deleteArtifacts(ids)

  closePanelIfShowing(result.deletedIds)
  reportDeleteResult(result.deletedIds.length, result.heldIds.length)
}

async function onDelete(artifact: ArtifactSummary) {
  await confirmAndDelete(
    [artifact.id],
    `Delete "${artifact.title}"?`,
    `Deletes this artifact, its versions and share links. ${DELETE_SUBTITLE}`,
  )
}

async function onBulkDelete() {
  const count = selectedCount.value

  await confirmAndDelete(
    [...selectedIds.value],
    `Delete ${count} artifact${count === 1 ? '' : 's'}?`,
    count === 1
      ? `Deletes this artifact, its versions and share links. ${DELETE_SUBTITLE}`
      : `Deletes ${count} artifacts, their versions and share links. `
        + DELETE_SUBTITLE,
  )
}
</script>
