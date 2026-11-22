<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="js-artifact-picker modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      data-testid="artifact-picker-dialog"
      @close="onDialogClose"
    >
      <div
        ref="boxRef"
        tabindex="-1"
        autofocus
        class="modal-box sheet-safe-padding flex max-w-2xl flex-col outline-none max-sm:h-[85dvh] sm:max-h-[80dvh]"
      >
        <div class="mb-4 flex shrink-0 items-start justify-between gap-3">
          <div>
            <h3
              :id="headingId"
              class="text-lg font-bold"
            >
              Add artifact
            </h3>
            <p class="mt-1 text-sm text-base-content/70">
              Artifacts from your chats
            </p>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-circle btn-ghost"
            aria-label="Close"
            data-testid="artifact-picker-close"
            @click="close"
          >
            <Icon
              name="lucide:x"
              size="18"
            />
          </button>
        </div>

        <div
          ref="searchWrapRef"
          class="shrink-0"
        >
          <UiSearchInput
            ref="searchInputRef"
            v-model="search"
            :is-searching="isRefreshing"
            placeholder="Search artifacts..."
            :show-keyboard-hint="false"
            class="input-sm sm:input-md"
          />
        </div>
        <ArtifactKindFilter
          :counts="kindCounts"
          :kind="appliedKind"
          test-id-prefix="artifact-picker"
          class="mt-3 shrink-0"
          @select="setKind"
          @fallback="setKind('all')"
        />

        <div
          ref="scrollRef"
          class="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-box border border-base-200 p-1"
          data-testid="artifact-picker-list-scroll"
        >
          <div
            v-if="hasError"
            class="alert alert-error alert-soft items-start"
            role="alert"
            data-testid="artifact-picker-error"
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
              data-testid="artifact-picker-retry"
              @click="refresh()"
            >
              Retry
            </button>
          </div>

          <div
            v-else-if="isSkeletonVisible"
            class="flex flex-col gap-2 p-1"
            aria-hidden="true"
            data-testid="artifact-picker-skeleton"
          >
            <div
              v-for="index in SKELETON_ROWS"
              :key="index"
              class="flex items-center gap-3 rounded-box border border-base-200/70 px-3 py-3"
            >
              <div class="flex-1 space-y-2">
                <div class="skeleton skeleton--default h-4 w-2/3 rounded-full" />
                <div class="skeleton skeleton--default h-3 w-1/2 rounded-full" />
              </div>
            </div>
          </div>

          <ul
            v-else-if="items.length"
            class="list"
            data-testid="artifact-picker-list"
          >
            <HistoryArtifactRow
              v-for="(artifact, index) in items"
              :key="artifact.id"
              :artifact="artifact"
              :index="index"
              mode="picker"
              @pick="onPick"
            />
          </ul>

          <div
            v-else-if="hasLoaded && !hasMore && isFiltered"
            class="px-6 py-10 text-center"
            data-testid="artifact-picker-no-results"
          >
            <Icon
              name="lucide:search-x"
              size="36"
              class="mx-auto mb-3 opacity-60"
            />
            <p class="font-medium">
              {{ noResultsText }}
            </p>
            <button
              type="button"
              class="btn btn-sm mt-4"
              data-testid="artifact-picker-clear"
              @click="reset"
            >
              Clear
            </button>
          </div>

          <div
            v-else-if="hasLoaded && !hasMore"
            class="px-6 py-10 text-center"
            data-testid="artifact-picker-empty"
          >
            <Icon
              name="lucide:app-window"
              size="36"
              class="mx-auto mb-3 opacity-60"
            />
            <p class="font-medium">
              No artifacts yet
            </p>
            <p class="mt-2 text-sm text-base-content/70">
              Ask for a quiz, a diagram or a small app in any chat
            </p>
          </div>

          <div
            v-if="hasMore && !hasError"
            ref="sentinelRef"
            class="js-artifact-picker-sentinel flex min-h-8 items-center justify-center py-2"
          >
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="isLoadingMore"
              data-testid="artifact-picker-load-more"
              @click="loadMore"
            >
              <span
                v-if="isLoadingMore"
                class="loading loading-spinner loading-xs"
              />
              Load more
            </button>
          </div>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
      >
        <button aria-label="Close">
          close
        </button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import type { ArtifactSummary } from '#shared/utils/artifacts'
import { ARTIFACT_KIND_LABELS } from '~/utils/artifact-parts'

const SKELETON_ROWS = 4
const DIALOG_READY_TIMEOUT_MS = 1000
const PICKER_FETCH_KEY = 'artifact-picker'

const emit = defineEmits<{
  pick: [artifact: ArtifactSummary]
}>()

const isOpen = defineModel<boolean>('open', { default: false })

interface SearchInputInstance {
  inputRef: HTMLInputElement | null
}

const { isDesktop } = useDevice()
const headingId = useId()
const dialogRef = useTemplateRef<HTMLDialogElement>('dialogRef')
const boxRef = useTemplateRef<HTMLDivElement>('boxRef')
const searchWrapRef = useTemplateRef<HTMLDivElement>('searchWrapRef')
const searchInputRef = shallowRef<SearchInputInstance | null>(null)
const scrollRef = useTemplateRef<HTMLDivElement>('scrollRef')
const sentinelRef = useTemplateRef<HTMLDivElement>('sentinelRef')
const hasBeenShown = shallowRef<boolean>(false)

const { search, appliedQuery, appliedKind, setKind, reset }
  = useArtifactPickerFilters()

const {
  items,
  kindCounts,
  hasMore,
  hasError,
  hasLoaded,
  errorMessage,
  isRefreshing,
  isSkeletonVisible,
  isLoadingMore,
  refresh,
  loadMore,
} = useArtifactLibrary(
  { query: appliedQuery, kind: appliedKind },
  { key: PICKER_FETCH_KEY },
)

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

useIntersectionObserver(
  sentinelRef,
  ([entry]) => {
    if (entry?.isIntersecting) {
      loadMore()
    }
  },
  { root: scrollRef },
)

watch([appliedQuery, appliedKind], async () => {
  await nextTick()

  if (scrollRef.value) {
    scrollRef.value.scrollTop = 0
  }
})

async function showDialog() {
  const dialog = await until(dialogRef).toBeTruthy({
    timeout: DIALOG_READY_TIMEOUT_MS,
    throwOnTimeout: false,
  })

  if (!dialog || dialog.open) {
    return
  }

  const searchWrap = searchWrapRef.value

  if (searchWrap) {
    searchWrap.inert = true
  }

  dialog.showModal()
  boxRef.value?.focus({ preventScroll: true })

  if (searchWrap) {
    searchWrap.inert = false
  }

  if (isDesktop) {
    searchInputRef.value?.inputRef?.focus({ preventScroll: true })
  }
}

watch(isOpen, async (open) => {
  if (!open) {
    if (dialogRef.value?.open) {
      dialogRef.value.close()
    }

    return
  }

  if (hasBeenShown.value) {
    const wasFiltered = isFiltered.value

    reset()

    if (!wasFiltered) {
      await refresh()
    }
  }

  hasBeenShown.value = true

  await showDialog()
}, { immediate: true, flush: 'post' })

function close() {
  isOpen.value = false
}

function onDialogClose() {
  isOpen.value = false
}

function onPick(artifact: ArtifactSummary) {
  emit('pick', artifact)
  close()
}
</script>
