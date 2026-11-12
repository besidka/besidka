<template>
  <HistoryPageShell active-tab="shared">
    <template #title>
      Shared
    </template>
    <template #subtitle>
      {{ subtitle }}
    </template>

    <template
      v-if="hasArtifactsTab"
      #toolbar
    >
      <HistoryBoxTabs
        :options="tabOptions"
        :model-value="activeTab"
        label="Filter shared items"
        test-id-prefix="shared-tab"
        @select="onSelectTab"
      />
    </template>

    <template v-if="activeTab === 'chats'">
      <HistoryActionsToolbar
        :selected-count="selectedCount"
        :visible="isSelectionMode"
        :is-deleting="false"
        :show-move-to-project="false"
        :show-delete="false"
        :show-cancel-sharing="true"
        @deselect="deselectAll"
        @cancel-sharing="onBulkCancelSharing"
      />

      <HistoryChatSections
        :pinned="[]"
        :chats="chats"
        :grouped-at="groupedAt"
        :is-loading-initial="isLoadingInitial && !hasCachedData"
        :is-selection-mode="isSelectionMode"
        :selected-ids="selectedIds"
        variant="shared"
        empty-state-mode="shared"
        empty-action-to="/chats/history"
        empty-action-label="View chats"
        @select="onToggleSelect"
        @enter-select="onEnterSelect"
        @cancel-sharing="onCancelSharing"
      />

      <div
        v-if="hasMore"
        ref="infiniteScrollRef"
        class="flex justify-center py-4"
      >
        <span
          v-if="isLoading"
          class="loading loading-spinner loading-sm"
        />
      </div>
    </template>

    <template v-else>
      <div
        v-if="hasError"
        class="alert alert-error alert-soft items-start"
        role="alert"
        data-testid="shared-artifacts-error"
      >
        <Icon
          name="lucide:circle-alert"
          size="18"
          class="shrink-0"
          aria-hidden="true"
        />
        <div class="grow">
          <p class="font-medium">
            Couldn't load your shared artifacts
          </p>
          <p class="text-sm">
            {{ errorMessage }}
          </p>
        </div>
        <button
          type="button"
          class="btn btn-sm"
          data-testid="shared-artifacts-retry"
          @click="refresh()"
        >
          Retry
        </button>
      </div>

      <div
        v-else-if="isInitialLoad"
        class="flex flex-col gap-2"
        aria-hidden="true"
        data-testid="shared-artifacts-skeleton"
      >
        <div
          v-for="index in SHARED_ARTIFACTS_SKELETON_ROWS"
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
        v-else-if="artifacts.length"
        class="list"
        data-testid="shared-artifacts-list"
      >
        <HistorySharedArtifactRow
          v-for="artifact in artifacts"
          :key="artifact.id"
          :artifact="artifact"
          :is-busy="busyIds.has(artifact.id)"
          @copy="copyLink"
          @manage="onManage"
          @revoke="onRevokeAll"
        />
      </ul>

      <div
        v-else
        class="rounded-box border border-dashed border-base-300 px-6 py-12 text-center"
        data-testid="shared-artifacts-empty"
      >
        <Icon
          name="lucide:share-2"
          size="40"
          class="mx-auto mb-3 opacity-60"
        />
        <p class="font-medium">
          No shared artifacts
        </p>
        <p class="mt-2 mb-4 text-sm text-base-content/70">
          Share an artifact with a public link and it appears here
        </p>
        <NuxtLink
          to="/chats/artifacts"
          class="btn btn-primary btn-sm"
        >
          View artifacts
        </NuxtLink>
      </div>

      <div
        v-if="hasMoreArtifacts && !hasError"
        class="flex justify-center py-2"
      >
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="isLoadingMoreArtifacts"
          data-testid="shared-artifacts-load-more"
          @click="loadMoreArtifacts"
        >
          <span
            v-if="isLoadingMoreArtifacts"
            class="loading loading-spinner loading-xs"
          />
          Load more
        </button>
      </div>
    </template>
  </HistoryPageShell>

  <LazyChatArtifactShareModal
    v-if="manageTarget"
    :key="manageTarget.id"
    v-model:open="isManageOpen"
    :artifact-id="manageTarget.id"
    :title="manageTarget.title"
    :current-version="manageTarget.currentVersion"
  />
</template>

<script setup lang="ts">
import type { SharedArtifactSummary } from '#shared/utils/artifacts'

definePageMeta({
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Shared',
})

const nuxtApp = useNuxtApp()
const route = useRoute()
const router = useRouter()
const shareFeature = useFeature('artifacts.share')

const hasArtifactsTab = computed<boolean>(() => {
  return shareFeature.value.active
})

const activeTab = computed<SharedHistoryTab>(() => {
  const tab = parseSharedHistoryTab(route.query.tab)

  return tab === 'artifacts' && hasArtifactsTab.value ? tab : 'chats'
})

const tabOptions = [
  { value: 'chats', label: 'Chats' },
  { value: 'artifacts', label: 'Artifacts' },
]

const subtitle = computed<string>(() => {
  return hasArtifactsTab.value
    ? 'Chats and artifacts you\'ve shared with a public link'
    : 'Chats you\'ve shared with a public link'
})

const isArtifactsTabActive = computed<boolean>(() => {
  return activeTab.value === 'artifacts'
})

const manageTarget = shallowRef<SharedArtifactSummary | null>(null)
const isManageOpen = shallowRef<boolean>(false)

const {
  chats,
  isLoading,
  isLoadingInitial,
  hasCachedData,
  hasMore,
  selectedIds,
  isSelectionMode,
  selectedCount,
  prime,
  hydrateAndRefresh,
  loadMore,
  handleSelect,
  enterSelectionMode,
  deselectAll,
  cancelSharing,
  cancelSharingSelected,
} = useSharedChats()

const groupedAt = useState<string>('shared-chats:grouped-at', () => {
  return new Date().toISOString()
})

if (import.meta.client && !nuxtApp.isHydrating) {
  groupedAt.value = new Date().toISOString()
}

if (import.meta.server && !hasCachedData.value) {
  const requestFetch = useRequestFetch()
  const response = await requestFetch('/api/v1/chats/shared')

  prime(response)
}

const {
  items: artifacts,
  hasMore: hasMoreArtifacts,
  hasError,
  isInitialLoad,
  errorMessage,
  isLoadingMore: isLoadingMoreArtifacts,
  busyIds,
  refresh,
  loadMore: loadMoreArtifacts,
  copyLink,
  revokeAll,
} = useSharedArtifacts({ enabled: isArtifactsTabActive })

const infiniteScrollRef = shallowRef<HTMLElement | null>(null)

onMounted(() => {
  hydrateAndRefresh()
})

useIntersectionObserver(
  infiniteScrollRef,
  ([entry]) => {
    if (entry?.isIntersecting && hasMore.value && !isLoading.value) {
      loadMore()
    }
  },
  { threshold: 0.1 },
)

watch(isManageOpen, async (open, wasOpen) => {
  if (open || !wasOpen) {
    return
  }

  await refresh()
})

async function onSelectTab(value: string) {
  const query = { ...route.query }

  if (value === 'artifacts') {
    query.tab = 'artifacts'
  } else {
    delete query.tab
  }

  await router.push({ path: route.path, query })
}

function onManage(artifact: SharedArtifactSummary) {
  manageTarget.value = artifact
  isManageOpen.value = true
}

async function onRevokeAll(artifact: SharedArtifactSummary) {
  const confirmation = await useConfirm({
    text: `Revoke all links to "${artifact.title}"?`,
    subtitle: 'Anyone with a link loses access. This cannot be undone.',
    alert: true,
    actions: ['Revoke all'],
  })

  if (!confirmation) {
    return
  }

  await revokeAll(artifact)
}

function onToggleSelect(chatId: string, index: number, shiftKey: boolean) {
  handleSelect(chatId, index, shiftKey)
}

function onEnterSelect(chatId: string, index: number) {
  enterSelectionMode(chatId, index)
}

async function onCancelSharing(chatId: string) {
  await cancelSharing(chatId)
}

async function onBulkCancelSharing() {
  const count = selectedCount.value
  const result = await useConfirm({
    text: `Cancel sharing for ${count} chat${count === 1 ? '' : 's'}?`,
    alert: true,
    actions: ['Cancel sharing'],
  })

  if (!result) return

  await cancelSharingSelected()
}
</script>
