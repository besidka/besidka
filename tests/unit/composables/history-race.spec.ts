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

describe('useHistory race handling', () => {
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

  it('retries the latest search after an in-flight initial request finishes', async () => {
    vi.useFakeTimers()

    const defaultDeferred = createDeferred<
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
        search?: string
      }
    }) => {
      if (options?.query?.search === 'Report') {
        return searchDeferred.promise
      }

      return defaultDeferred.promise
    })
    vi.stubGlobal('$fetch', fetchMock)

    const history = createHistoryComposable()
    const initialRequest = history.hydrateAndRefresh()

    history.search.value = 'Report'
    await flushPromises()
    vi.advanceTimersByTime(180)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(history.chats.value).toEqual([])

    defaultDeferred.resolve(createHistoryResponse({
      chats: [createHistoryChat({ id: 'chat-default', title: 'Default chat' })],
    }))
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/chats/history', {
      query: { search: 'Report' },
    })

    searchDeferred.resolve(createHistoryResponse({ chats: [searchChat] }))
    await initialRequest
    await flushPromises()

    expect(history.chats.value).toEqual([searchChat])
    expect(history.isSearching.value).toBe(false)
  })
})
