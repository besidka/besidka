import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { useHistory } from '../../../app/composables/history'
import {
  createHistoryChat,
  createHistoryResponse,
} from '../../setup/helpers/history-fixtures'
import {
  installMockNuxtState,
  resetMockNuxtState,
} from '../../setup/helpers/nuxt-state'

function flushPromises() {
  return Promise.resolve()
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return {
    promise,
    resolve,
  }
}

const scopes: EffectScope[] = []

function createHistoryComposable() {
  const scope = effectScope()
  const history = scope.run(() => useHistory())

  scopes.push(scope)

  if (!history) {
    throw new Error('Failed to create history composable')
  }

  return history
}

describe('useHistory load-more race handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    resetMockNuxtState()
    installMockNuxtState()
    vi.stubGlobal('$fetch', vi.fn())
  })

  afterEach(() => {
    scopes.splice(0).forEach((scope) => {
      scope.stop()
    })
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retries the active search after load-more resolves for an old key', async () => {
    vi.useFakeTimers()

    const firstChat = createHistoryChat({ id: 'chat-1', title: 'Chat 1' })
    const loadMoreDeferred = createDeferred<
      ReturnType<typeof createHistoryResponse>
    >()
    const searchDeferred = createDeferred<
      ReturnType<typeof createHistoryResponse>
    >()
    const searchChat = createHistoryChat({
      id: 'chat-search',
      title: 'Search chat',
    })
    const fetchMock = vi.fn((url: string, options?: {
      query?: {
        cursor?: string
        search?: string
      }
    }) => {
      if (options?.query?.search === 'Report') {
        return searchDeferred.promise
      }

      return loadMoreDeferred.promise
    })
    vi.stubGlobal('$fetch', fetchMock)

    const history = createHistoryComposable()
    history.prime(createHistoryResponse({
      chats: [firstChat],
      nextCursor: '2026-03-09T10:00:00.000Z',
    }))

    const loadMoreRequest = history.loadMore()

    history.search.value = 'Report'
    await flushPromises()
    vi.advanceTimersByTime(180)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    loadMoreDeferred.resolve(createHistoryResponse({
      chats: [createHistoryChat({ id: 'chat-2', title: 'Chat 2' })],
      nextCursor: null,
    }))
    await flushPromises()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/chats/history', {
      query: { search: 'Report' },
    })

    searchDeferred.resolve(createHistoryResponse({ chats: [searchChat] }))
    await loadMoreRequest
    await flushPromises()

    expect(history.chats.value).toEqual([searchChat])
    expect(history.nextCursor.value).toBeNull()
  })
})
