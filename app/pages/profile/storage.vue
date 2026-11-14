<template>
  <div class="mb-8 text-center">
    <h1 class="text-4xl font-bold">Storage</h1>
    <h2 class="mt-2">One allowance for everything you keep in Besidka</h2>
  </div>
  <UiBubble data-testid="storage-page">
    <div class="grid gap-6 p-3 sm:p-4">
      <div
        v-if="hasError"
        role="alert"
        class="alert alert-error alert-soft"
        data-testid="storage-error"
      >
        <Icon
          name="lucide:circle-alert"
          size="16"
          class="shrink-0"
          aria-hidden="true"
        />
        <span>Storage did not load.</span>
        <UiButton
          text="Retry"
          size="sm"
          mode="default"
          outline
          normal-case
          data-testid="storage-retry"
          @click="refresh()"
        />
      </div>
      <div
        v-else-if="isSkeletonVisible"
        class="grid gap-4"
        aria-hidden="true"
        data-testid="storage-skeleton"
      >
        <div class="skeleton skeleton--default h-6 w-1/2 rounded-full" />
        <div class="skeleton skeleton--default h-3 w-full rounded-full" />
        <div
          v-for="index in SKELETON_ROWS"
          :key="index"
          class="skeleton skeleton--default h-16 w-full rounded-box"
        />
      </div>
      <template v-else-if="stats">
        <div class="grid gap-2">
          <div class="flex items-center justify-between gap-3">
            <p
              class="text-lg font-bold"
              data-testid="storage-usage-text"
            >
              {{ usageText }}
            </p>
            <span
              class="badge badge-soft"
              :class="percentageBadgeClass"
              data-testid="storage-percentage"
            >
              {{ stats.percentage }}%
            </span>
          </div>
          <progress
            class="progress w-full"
            :class="progressClass"
            :value="progressValue"
            max="100"
            aria-label="Storage used"
            data-testid="storage-progress"
          />
        </div>
        <div
          v-if="isFull"
          role="alert"
          class="alert alert-warning alert-soft"
          data-testid="storage-full-notice"
        >
          <Icon
            name="lucide:triangle-alert"
            size="16"
            class="shrink-0"
            aria-hidden="true"
          />
          <span>
            Storage is full. What you have stays, but new uploads, images,
            documents and artifacts are refused until you free some space.
          </span>
        </div>
        <p
          v-if="isEmpty"
          class="rounded-box border border-base-200/70 p-6 text-center text-sm
            text-base-content/70"
          data-testid="storage-empty"
        >
          Nothing is stored yet. Uploaded files, generated images,
          artifacts and project knowledge will show up here.
        </p>
        <ul
          v-else
          class="grid gap-3"
          data-testid="storage-categories"
        >
          <li
            v-for="category in categories"
            :key="category.id"
            class="flex items-center gap-3 rounded-box border
              border-base-200/70 px-3 py-3"
            :data-testid="`storage-category-${category.id}`"
          >
            <span
              class="flex size-10 shrink-0 items-center justify-center
                rounded-field bg-base-200"
            >
              <Icon
                :name="category.meta.icon"
                size="20"
                aria-hidden="true"
              />
            </span>
            <div class="min-w-0 grow">
              <p class="font-medium">{{ category.meta.label }}</p>
              <p
                class="text-sm text-base-content/70"
                :data-testid="`storage-category-${category.id}-summary`"
              >
                {{ category.size }} · {{ category.countText }}
              </p>
              <p class="text-xs text-base-content/60">
                {{ category.meta.hint }}
              </p>
            </div>
            <UiButton
              v-if="category.canManage"
              :to="category.to"
              text="Manage"
              size="sm"
              mode="default"
              outline
              normal-case
              :data-testid="`storage-manage-${category.id}`"
              @click="category.onManage"
            />
          </li>
        </ul>
        <p class="text-xs text-base-content/60">
          Data that people store inside an artifact you shared is not counted
          against your allowance.
        </p>
      </template>
    </div>
  </UiBubble>
</template>
<script setup lang="ts">
import type { FileSourceFilter } from '~/types/file-manager'
import { formatFileSize } from '#shared/utils/files'

definePageMeta({
  layout: 'profile',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Storage',
  robots: 'noindex, nofollow',
})

const SKELETON_DELAY_MS = 300
const SKELETON_ROWS = 5
const FILE_MANAGER_TARGET_PATH = '/chats/new'

const { data: stats, status, error, refresh } = useLazyFetch(
  '/api/v1/storage',
  { key: 'profile-storage' },
)
const artifactsFeature = useFeature('artifacts')
const { requestOpen } = useFilesModalHandoff()

const isSkeletonVisible = shallowRef<boolean>(false)

const hasError = computed<boolean>(() => {
  return !stats.value && (status.value === 'error' || !!error.value)
})

const progressValue = computed<number>(() => {
  return Math.min(Math.max(stats.value?.percentage ?? 0, 0), 100)
})

const isFull = computed<boolean>(() => {
  return !!stats.value && stats.value.used >= stats.value.total
    && stats.value.total > 0
})

const progressTone = computed(() => {
  return getStorageProgressTone(stats.value?.percentage ?? 0)
})

const progressClass = computed<string>(() => {
  const classes = {
    primary: 'progress-primary',
    warning: 'progress-warning',
    error: 'progress-error',
  } as const

  return classes[progressTone.value]
})

const percentageBadgeClass = computed<string>(() => {
  const tones = {
    primary: 'badge-neutral',
    warning: 'badge-warning',
    error: 'badge-error',
  } as const

  return tones[progressTone.value]
})

const usageText = computed<string>(() => {
  if (!stats.value) {
    return ''
  }

  return `${formatFileSize(stats.value.used)} of `
    + `${formatFileSize(stats.value.total)} used`
})

const isEmpty = computed<boolean>(() => {
  if (!stats.value) {
    return false
  }

  return stats.value.breakdown.categories.every((category) => {
    return category.bytes === 0 && category.count === 0
  })
})

async function openFileManager(source: FileSourceFilter) {
  requestOpen('select', FILE_MANAGER_TARGET_PATH, source)

  await navigateTo(FILE_MANAGER_TARGET_PATH)
}

const categories = computed(() => {
  const rows = stats.value?.breakdown.categories ?? []

  return rows.filter((row) => {
    return isKnownStorageCategory(row.id)
  }).map((row) => {
    const meta = STORAGE_CATEGORY_META[row.id]
    const hasData = row.count > 0 || row.bytes > 0
    let to: string | undefined
    let onManage: (() => Promise<void>) | undefined
    let canManage = hasData

    if (meta.action === 'files-assistant') {
      onManage = () => openFileManager('assistant')
    } else if (meta.action === 'files-upload') {
      onManage = () => openFileManager('upload')
    } else if (meta.action === 'artifacts') {
      to = '/chats/artifacts'
      canManage = canManage && artifactsFeature.value.active
    } else {
      to = '/chats/projects'
    }

    return {
      id: row.id,
      meta,
      size: formatFileSize(row.bytes),
      countText: formatStorageCount(row.id, row.count),
      canManage,
      to,
      onManage,
    }
  })
})

watch(status, (current, _previous, onCleanup) => {
  if (!import.meta.client || current !== 'pending' || stats.value) {
    isSkeletonVisible.value = false

    return
  }

  const timer = setTimeout(() => {
    isSkeletonVisible.value = true
  }, SKELETON_DELAY_MS)

  onCleanup(() => {
    clearTimeout(timer)
    isSkeletonVisible.value = false
  })
}, { immediate: true })
</script>
