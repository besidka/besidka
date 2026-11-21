import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import plugin from '../../../app/plugins/02.chunk-error.client'
import {
  CHUNK_RELOAD_GUARD_MS,
  NUXT_RELOAD_STORAGE_KEY,
} from '~/utils/chunk-load-error'

const mocks = vi.hoisted(() => ({
  draft: null as string | null,
  reloadNuxtApp: vi.fn(),
  useInfoMessage: vi.fn(),
}))

mockNuxtImport('reloadNuxtApp', () => mocks.reloadNuxtApp)
mockNuxtImport('useInfoMessage', () => mocks.useInfoMessage)
mockNuxtImport('usePreferenceStorage', () => {
  return () => ({ getItem: () => mocks.draft })
})

type ChunkErrorHook = (payload: { error: unknown }) => void

const STALE_CHUNK_ERROR = new TypeError(
  'Failed to fetch dynamically imported module: /_nuxt/old.js',
)

function install() {
  const hooks: ChunkErrorHook[] = []
  const result = plugin({
    runWithContext: (fn: () => unknown) => fn(),
    hook: (name: string, handler: ChunkErrorHook) => {
      if (name === 'app:chunkError') {
        hooks.push(handler)
      }
    },
  } as never) as unknown as {
    provide: { recoverFromChunkError: () => void }
  }

  return {
    emitChunkError: (error: unknown = STALE_CHUNK_ERROR) => {
      hooks.forEach(hook => hook({ error }))
    },
    recover: result.provide.recoverFromChunkError,
  }
}

describe('chunk-error-recovery plugin', () => {
  beforeEach(() => {
    mocks.draft = null
    mocks.reloadNuxtApp.mockReset()
    mocks.useInfoMessage.mockReset()
    window.sessionStorage.clear()
    useState<boolean>('chat-streaming').value = false
  })

  afterEach(() => {
    window.sessionStorage.clear()
  })

  it('reloads once for a stale chunk and shows no error toast', () => {
    const { emitChunkError, recover } = install()

    emitChunkError()
    recover()

    expect(mocks.reloadNuxtApp).toHaveBeenCalledTimes(1)
    expect(mocks.reloadNuxtApp).toHaveBeenCalledWith({
      path: window.location.pathname + window.location.search,
      ttl: CHUNK_RELOAD_GUARD_MS,
    })
    expect(mocks.useInfoMessage).not.toHaveBeenCalled()
  })

  it('asks for a manual reload instead of looping', () => {
    window.sessionStorage.setItem(NUXT_RELOAD_STORAGE_KEY, JSON.stringify({
      path: window.location.pathname + window.location.search,
      expires: Date.now() + CHUNK_RELOAD_GUARD_MS,
    }))

    const { emitChunkError } = install()

    emitChunkError()
    emitChunkError()

    expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
    expect(mocks.useInfoMessage).toHaveBeenCalledTimes(1)
    expect(mocks.useInfoMessage).toHaveBeenCalledWith(
      'Besidka was updated. Reload the page to continue.',
    )
  })

  it('waits for a streaming reply to end before reloading', async () => {
    const isStreaming = useState<boolean>('chat-streaming')

    isStreaming.value = true

    const { emitChunkError } = install()

    emitChunkError()

    expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
    expect(mocks.useInfoMessage).toHaveBeenCalledWith(
      'Besidka was updated. The page reloads when this reply finishes.',
    )

    isStreaming.value = false
    await nextTick()

    expect(mocks.reloadNuxtApp).toHaveBeenCalledTimes(1)
  })

  it('ignores a failed async data fetch reported as a chunk error', () => {
    const { emitChunkError } = install()
    const fetchError = Object.assign(
      new Error(
        '[GET] "/api/v1/shared/test/context": 404 Page not found',
      ),
      { name: 'FetchError', statusCode: 404 },
    )

    emitChunkError(fetchError)

    expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
    expect(mocks.useInfoMessage).not.toHaveBeenCalled()
  })

  it('keeps an unsent message instead of reloading over it', () => {
    mocks.draft = 'Half-written question'

    const { emitChunkError } = install()

    emitChunkError()

    expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
    expect(mocks.useInfoMessage).toHaveBeenCalledWith(
      'Besidka was updated. Reload the page to continue.',
    )
  })
})
