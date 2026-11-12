import type { Ref } from 'vue'
import { parseError } from 'evlog'
import type {
  ArtifactShareSummary,
  SharedArtifactSummary,
} from '#shared/utils/artifacts'

export type SharedHistoryTab = 'chats' | 'artifacts'

export const SHARED_ARTIFACTS_PAGE_SIZE = 20
export const SHARED_ARTIFACTS_SKELETON_ROWS = 4
export const SHARED_HISTORY_PATH = '/chats/shared'

export function parseSharedHistoryTab(value: unknown): SharedHistoryTab {
  const text = Array.isArray(value) ? value[0] : value

  return text === 'artifacts' ? 'artifacts' : 'chats'
}

export function formatActiveLinkCount(count: number): string {
  return `${count} active link${count === 1 ? '' : 's'}`
}

function artifactSharesPath(artifactId: string): string {
  return `/api/v1/artifacts/${encodeURIComponent(artifactId)}/shares`
}

async function loadActiveShares(
  artifactId: string,
): Promise<ArtifactShareSummary[]> {
  const response = await $fetch<{ shares: ArtifactShareSummary[] }>(
    artifactSharesPath(artifactId),
  )

  return response.shares.filter((share) => {
    return share.status === 'active'
  })
}

async function writeClipboardText(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': text.then((value) => {
          return new Blob([value], { type: 'text/plain' })
        }),
      }),
    ])

    return
  }

  await navigator.clipboard.writeText(await text)
}

/**
 * Artifacts with at least one live public link. Loaded lazily the first time
 * `enabled` turns true, so the Chats tab never pays for it. The row actions
 * that need link details (copy, revoke all) read the artifact's own link
 * list, because the list endpoint only returns counts.
 */
export function useSharedArtifacts(options: { enabled: Ref<boolean> }) {
  const { data, status, error, execute } = useLazyFetch(
    '/api/v1/artifacts/shared',
    {
      key: 'shared-artifacts',
      query: { limit: SHARED_ARTIFACTS_PAGE_SIZE },
      immediate: false,
    },
  )

  const extraItems = shallowRef<SharedArtifactSummary[]>([])
  const removedIds = shallowRef<Set<string>>(new Set())
  const isLoadingMore = shallowRef<boolean>(false)
  const busyIds = shallowRef<Set<string>>(new Set())

  const isPending = computed<boolean>(() => {
    return status.value === 'pending'
  })

  const hasLoaded = computed<boolean>(() => !!data.value)

  const isInitialLoad = computed<boolean>(() => {
    return !hasLoaded.value && !error.value
  })

  const items = computed<SharedArtifactSummary[]>(() => {
    const seen = new Set<string>()
    const merged: SharedArtifactSummary[] = []

    for (const item of [...(data.value?.items ?? []), ...extraItems.value]) {
      if (seen.has(item.id) || removedIds.value.has(item.id)) {
        continue
      }

      seen.add(item.id)
      merged.push(item)
    }

    return merged
  })

  const total = computed<number>(() => {
    return Math.max(
      (data.value?.total ?? 0) - removedIds.value.size,
      0,
    )
  })

  const hasMore = computed<boolean>(() => {
    return items.value.length < total.value
  })

  const hasError = computed<boolean>(() => {
    return !!error.value && !data.value
  })

  const errorMessage = computed<string>(() => {
    return error.value
      ? parseError(error.value).message || 'Please try again.'
      : ''
  })

  watch(
    options.enabled,
    async (enabled) => {
      if (enabled && !data.value && !isPending.value) {
        await execute()
      }
    },
    { immediate: true },
  )

  watch(data, () => {
    extraItems.value = []
    removedIds.value = new Set()
  })

  async function refresh() {
    await execute()
  }

  async function loadMore() {
    if (isLoadingMore.value || !hasMore.value) {
      return
    }

    isLoadingMore.value = true

    try {
      const response = await $fetch('/api/v1/artifacts/shared', {
        query: {
          limit: SHARED_ARTIFACTS_PAGE_SIZE,
          offset: items.value.length + removedIds.value.size,
        },
      })

      extraItems.value = [...extraItems.value, ...response.items]
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to load more artifacts',
        parsedException.why,
      )
    } finally {
      isLoadingMore.value = false
    }
  }

  function setBusy(artifactId: string, isBusy: boolean) {
    const next = new Set(busyIds.value)

    if (isBusy) {
      next.add(artifactId)
    } else {
      next.delete(artifactId)
    }

    busyIds.value = next
  }

  async function copyLink(artifact: SharedArtifactSummary): Promise<boolean> {
    const url = loadActiveShares(artifact.id).then((shares) => {
      const link = shares.find(share => !!share.url)

      if (!link?.url) {
        throw new Error('No active link to copy')
      }

      return link.url
    })

    try {
      await writeClipboardText(url)
      useSuccessMessage('Link copied')

      return true
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to copy the link',
        parsedException.why,
      )

      return false
    }
  }

  async function revokeAll(artifact: SharedArtifactSummary): Promise<boolean> {
    if (busyIds.value.has(artifact.id)) {
      return false
    }

    setBusy(artifact.id, true)

    try {
      const shares = await loadActiveShares(artifact.id)

      for (const share of shares) {
        await $fetch(
          `${artifactSharesPath(artifact.id)}/${
            encodeURIComponent(share.shareId)
          }/revoke`,
          { method: 'POST' },
        )
      }

      removedIds.value = new Set([...removedIds.value, artifact.id])
      useSuccessMessage('Sharing cancelled')

      return true
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to cancel sharing',
        parsedException.why,
      )
      await refresh()

      return false
    } finally {
      setBusy(artifact.id, false)
    }
  }

  return {
    items,
    total,
    hasMore,
    hasError,
    hasLoaded,
    isInitialLoad,
    errorMessage,
    isLoadingMore,
    busyIds,
    refresh,
    loadMore,
    copyLink,
    revokeAll,
  }
}
