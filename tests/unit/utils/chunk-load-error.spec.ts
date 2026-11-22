import { describe, expect, it, vi } from 'vitest'
import {
  CHUNK_RELOAD_GUARD_MS,
  NUXT_RELOAD_STORAGE_KEY,
  isChunkLoadError,
  isChunkReloadSpent,
  recoverFromChunkLoadError,
} from '~/utils/chunk-load-error'

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))

  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe('isChunkLoadError', () => {
  it('recognizes the stale chunk errors of every engine', () => {
    expect(isChunkLoadError(new TypeError('Importing a module script failed.')))
      .toBe(true)
    expect(isChunkLoadError(new TypeError(
      'Failed to fetch dynamically imported module: /_nuxt/Dw1.js',
    ))).toBe(true)
    expect(isChunkLoadError(new TypeError(
      'error loading dynamically imported module: /_nuxt/Dw1.js',
    ))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /a.css')))
      .toBe(true)
    expect(isChunkLoadError(Object.assign(new Error('x'), {
      name: 'ChunkLoadError',
    }))).toBe(true)
  })

  it('leaves other errors alone', () => {
    expect(isChunkLoadError(new Error('Load failed'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError({ message: 42 })).toBe(false)
  })
})

describe('isChunkReloadSpent', () => {
  function reloadRecord(path: string, expires: number) {
    return createStorage({
      [NUXT_RELOAD_STORAGE_KEY]: JSON.stringify({ path, expires }),
    })
  }

  it('is spent only for the same path inside the guard window', () => {
    expect(isChunkReloadSpent(createStorage(), '/chats/a', 1_000)).toBe(false)
    expect(isChunkReloadSpent(reloadRecord('/chats/a', 2_000), '/chats/a', 1_000))
      .toBe(true)
    expect(isChunkReloadSpent(reloadRecord('/chats/a', 2_000), '/chats/b', 1_000))
      .toBe(false)
    expect(isChunkReloadSpent(reloadRecord('/chats/a', 500), '/chats/a', 1_000))
      .toBe(false)
  })

  it('counts a storage it cannot read as spent', () => {
    expect(isChunkReloadSpent(undefined, '/chats/a')).toBe(true)
    expect(isChunkReloadSpent({
      getItem: () => {
        throw new Error('SecurityError')
      },
    }, '/chats/a')).toBe(true)
    expect(isChunkReloadSpent(
      createStorage({ [NUXT_RELOAD_STORAGE_KEY]: '{not json' }),
      '/chats/a',
    )).toBe(true)
  })
})

describe('recoverFromChunkLoadError', () => {
  it('reloads when the page has not reloaded for this path yet', () => {
    const reload = vi.fn()

    expect(recoverFromChunkLoadError({
      isReplyInProgress: false,
      hasUnsentDraft: false,
      storage: createStorage(),
      path: '/chats/a',
      reload,
    })).toBe('reloaded')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('asks the user instead of reloading again', () => {
    const reload = vi.fn()
    const storage = createStorage({
      [NUXT_RELOAD_STORAGE_KEY]: JSON.stringify({
        path: '/chats/a',
        expires: 1_000 + CHUNK_RELOAD_GUARD_MS,
      }),
    })

    expect(recoverFromChunkLoadError({
      isReplyInProgress: false,
      hasUnsentDraft: false,
      storage,
      path: '/chats/a',
      reload,
      now: 1_000,
    })).toBe('blocked')
    expect(reload).not.toHaveBeenCalled()
  })

  it('never reloads over an unsent message', () => {
    const reload = vi.fn()

    expect(recoverFromChunkLoadError({
      isReplyInProgress: false,
      hasUnsentDraft: true,
      storage: createStorage(),
      path: '/chats/a',
      reload,
    })).toBe('blocked')
    expect(reload).not.toHaveBeenCalled()
  })

  it('waits for a streaming reply instead of cutting it off', () => {
    const reload = vi.fn()

    expect(recoverFromChunkLoadError({
      isReplyInProgress: true,
      hasUnsentDraft: false,
      storage: createStorage(),
      path: '/chats/a',
      reload,
    })).toBe('deferred')
    expect(reload).not.toHaveBeenCalled()
  })
})
