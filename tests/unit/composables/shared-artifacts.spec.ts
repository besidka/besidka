import { effectScope, nextTick, ref } from 'vue'
import type { EffectScope } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SharedArtifactSummary } from '../../../shared/utils/artifacts'
import {
  SHARED_ARTIFACTS_PAGE_SIZE,
  formatActiveLinkCount,
  parseSharedHistoryTab,
  useSharedArtifacts,
} from '../../../app/composables/shared-artifacts'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  lazyFetch: vi.fn(),
  errorMessage: vi.fn(),
  successMessage: vi.fn(),
}))

const lazyData = ref<Record<string, any> | undefined>(undefined)
const lazyStatus = ref<string>('idle')
const lazyError = ref<unknown>(null)
const lazyExecute = vi.fn()

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)
mockNuxtImport('useSuccessMessage', () => mocks.successMessage)

mockNuxtImport('useLazyFetch', () => {
  return (url: string, options: unknown) => {
    mocks.lazyFetch(url, options)

    return {
      data: lazyData,
      status: lazyStatus,
      error: lazyError,
      execute: lazyExecute,
    }
  }
})

function createShared(id: string): SharedArtifactSummary {
  return {
    id,
    title: `Artifact ${id}`,
    kind: 'html',
    currentVersion: 1,
    updatedAt: '2026-11-09T08:00:00.000Z',
    activeShareCount: 1,
    nearestExpiresAt: null,
    hasPermanentLink: true,
  }
}

function createShare(shareId: string, status = 'active') {
  return {
    shareId,
    url: status === 'active' ? `https://besidka.test/artifacts/${shareId}` : null,
    status,
  }
}

describe('shared-artifacts helpers', () => {
  it('opens the Artifacts tab only for the artifacts value', () => {
    expect(parseSharedHistoryTab('artifacts')).toBe('artifacts')
    expect(parseSharedHistoryTab(['artifacts'])).toBe('artifacts')
    expect(parseSharedHistoryTab('chats')).toBe('chats')
    expect(parseSharedHistoryTab('other')).toBe('chats')
    expect(parseSharedHistoryTab(undefined)).toBe('chats')
  })

  it('pluralises the active link count', () => {
    expect(formatActiveLinkCount(1)).toBe('1 active link')
    expect(formatActiveLinkCount(3)).toBe('3 active links')
  })
})

describe('useSharedArtifacts', () => {
  let scope: EffectScope
  let enabled: ReturnType<typeof ref<boolean>>

  function setup() {
    scope = effectScope()

    return scope.run(() => useSharedArtifacts({ enabled }))!
  }

  beforeEach(() => {
    enabled = ref<boolean>(false)
    lazyData.value = undefined
    lazyStatus.value = 'idle'
    lazyError.value = null
    lazyExecute.mockReset().mockResolvedValue(undefined)
    mocks.fetch.mockReset()
    mocks.lazyFetch.mockReset()
    mocks.errorMessage.mockReset()
    mocks.successMessage.mockReset()
  })

  afterEach(() => {
    scope.stop()
  })

  it('does not fetch until the Artifacts tab is enabled', async () => {
    setup()

    expect(lazyExecute).not.toHaveBeenCalled()
    expect(mocks.lazyFetch).toHaveBeenCalledWith(
      '/api/v1/artifacts/shared',
      expect.objectContaining({
        immediate: false,
        query: { limit: SHARED_ARTIFACTS_PAGE_SIZE },
      }),
    )

    enabled.value = true
    await nextTick()

    expect(lazyExecute).toHaveBeenCalledTimes(1)
  })

  it('fetches immediately when it starts enabled', () => {
    enabled.value = true
    setup()

    expect(lazyExecute).toHaveBeenCalledTimes(1)
  })

  it('appends the next page after the loaded items', async () => {
    lazyData.value = { items: [createShared('a1')], total: 2 }

    const state = setup()

    expect(state.hasMore.value).toBe(true)

    mocks.fetch.mockResolvedValueOnce({
      items: [createShared('a2')],
      total: 2,
    })
    await state.loadMore()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/artifacts/shared', {
      query: { limit: SHARED_ARTIFACTS_PAGE_SIZE, offset: 1 },
    })
    expect(state.items.value.map(item => item.id)).toEqual(['a1', 'a2'])
    expect(state.hasMore.value).toBe(false)
  })

  it('copies the first active link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('ClipboardItem', undefined)

    mocks.fetch.mockResolvedValueOnce({
      shares: [createShare('sh_old', 'revoked'), createShare('sh_new')],
    })

    const state = setup()
    const copied = await state.copyLink(createShared('a1'))

    expect(copied).toBe(true)
    expect(writeText).toHaveBeenCalledWith(
      'https://besidka.test/artifacts/sh_new',
    )
    expect(mocks.successMessage).toHaveBeenCalledWith('Link copied')

    vi.unstubAllGlobals()
  })

  it('revokes every active link one by one and drops the row', async () => {
    lazyData.value = {
      items: [createShared('a1'), createShared('a2')],
      total: 2,
    }
    mocks.fetch
      .mockResolvedValueOnce({
        shares: [
          createShare('sh_one'),
          createShare('sh_ended', 'expired'),
          createShare('sh_two'),
        ],
      })
      .mockResolvedValue({ revoked: 1 })

    const state = setup()
    const revoked = await state.revokeAll(createShared('a1'))

    expect(revoked).toBe(true)
    expect(mocks.fetch.mock.calls.slice(1)).toEqual([
      ['/api/v1/artifacts/a1/shares/sh_one/revoke', { method: 'POST' }],
      ['/api/v1/artifacts/a1/shares/sh_two/revoke', { method: 'POST' }],
    ])
    expect(state.items.value.map(item => item.id)).toEqual(['a2'])
    expect(state.total.value).toBe(1)
    expect(state.busyIds.value.size).toBe(0)
    expect(mocks.successMessage).toHaveBeenCalledWith('Sharing cancelled')
  })

  it('keeps the row and refreshes when a revoke fails', async () => {
    lazyData.value = { items: [createShared('a1')], total: 1 }
    mocks.fetch
      .mockResolvedValueOnce({ shares: [createShare('sh_one')] })
      .mockRejectedValueOnce(new Error('Nope'))

    const state = setup()
    const revoked = await state.revokeAll(createShared('a1'))

    expect(revoked).toBe(false)
    expect(state.items.value.map(item => item.id)).toEqual(['a1'])
    expect(mocks.errorMessage).toHaveBeenCalledTimes(1)
    expect(lazyExecute).toHaveBeenCalledTimes(1)
    expect(state.busyIds.value.size).toBe(0)
  })
})
