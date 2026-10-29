import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import plugin from '../../../app/plugins/webmcp.client'

interface RegisteredCall {
  tool: WebMcpTool
  signal: AbortSignal | undefined
}

const mocks = vi.hoisted(() => ({
  queryCollection: vi.fn(),
  navigateTo: vi.fn(),
}))

mockNuxtImport('queryCollection', () => mocks.queryCollection)
mockNuxtImport('navigateTo', () => mocks.navigateTo)

const EXECUTE_OPTIONS = { signal: new AbortController().signal }

function createModelContext() {
  const calls: RegisteredCall[] = []

  const registerTool = vi.fn(
    async (tool: WebMcpTool, options?: WebMcpRegisterToolOptions) => {
      calls.push({ tool, signal: options?.signal })
    },
  )

  return { registerTool, calls }
}

function createFakeNuxtApp() {
  const unmountCallbacks: Array<() => void> = []

  return {
    vueApp: {
      onUnmount: vi.fn((callback: () => void) => {
        unmountCallbacks.push(callback)
      }),
    },
    runWithContext: <T>(callback: () => T): T => callback(),
    unmount() {
      for (const callback of unmountCallbacks) {
        callback()
      }
    },
  }
}

function install() {
  const nuxtApp = createFakeNuxtApp()

  plugin(nuxtApp as never)

  return nuxtApp
}

function defineModelContext(
  target: 'document' | 'navigator',
  value: WebMcpModelContext,
) {
  Object.defineProperty(target === 'document' ? document : navigator, 'modelContext', {
    value,
    configurable: true,
  })
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('webmcp plugin', () => {
  beforeEach(() => {
    mocks.queryCollection.mockReset()
    mocks.navigateTo.mockReset()
    mocks.navigateTo.mockResolvedValue(undefined)
  })

  afterEach(() => {
    Reflect.deleteProperty(document, 'modelContext')
    Reflect.deleteProperty(navigator, 'modelContext')
    vi.unstubAllGlobals()
  })

  it('registers nothing and does not throw without the API', async () => {
    const nuxtApp = install()

    await flush()

    expect(nuxtApp.vueApp.onUnmount).not.toHaveBeenCalled()
  })

  it('registers the three public tools on document.modelContext', async () => {
    const modelContext = createModelContext()

    defineModelContext('document', modelContext)
    install()
    await flush()

    expect(modelContext.calls.map(call => call.tool.name)).toEqual([
      'list_key_guides',
      'get_page_markdown',
      'open_page',
    ])
  })

  it('falls back to navigator.modelContext', async () => {
    const modelContext = createModelContext()

    defineModelContext('navigator', modelContext)
    install()
    await flush()

    expect(modelContext.registerTool).toHaveBeenCalledTimes(3)
  })

  it('prefers document.modelContext over navigator.modelContext', async () => {
    const documentContext = createModelContext()
    const navigatorContext = createModelContext()

    defineModelContext('document', documentContext)
    defineModelContext('navigator', navigatorContext)
    install()
    await flush()

    expect(documentContext.registerTool).toHaveBeenCalledTimes(3)
    expect(navigatorContext.registerTool).not.toHaveBeenCalled()
  })

  it('keeps registering when one registration rejects', async () => {
    const modelContext = createModelContext()

    modelContext.registerTool.mockRejectedValueOnce(new Error('duplicate'))
    defineModelContext('document', modelContext)
    install()
    await flush()

    expect(modelContext.registerTool).toHaveBeenCalledTimes(3)
  })

  it('only registers read-only tools except open_page', async () => {
    const modelContext = createModelContext()

    defineModelContext('document', modelContext)
    install()
    await flush()

    const readOnlyByName = Object.fromEntries(
      modelContext.calls.map((call) => {
        return [call.tool.name, call.tool.annotations?.readOnlyHint]
      }),
    )

    expect(readOnlyByName).toEqual({
      list_key_guides: true,
      get_page_markdown: true,
      open_page: false,
    })
  })

  it('aborts the shared signal when the app unmounts', async () => {
    const modelContext = createModelContext()

    defineModelContext('document', modelContext)

    const nuxtApp = install()

    await flush()

    const signals = modelContext.calls.map(call => call.signal)

    expect(signals.every(signal => signal && !signal.aborted)).toBe(true)

    nuxtApp.unmount()

    expect(signals.every(signal => signal?.aborted)).toBe(true)
  })

  it('lists key guides from the keyGuides collection once', async () => {
    const all = vi.fn().mockResolvedValue([
      { path: '/guides/claude-api-key', title: 'Claude API key' },
    ])
    const order = vi.fn(() => ({ all }))
    const select = vi.fn(() => ({ order }))

    mocks.queryCollection.mockReturnValue({ select })

    const modelContext = createModelContext()

    defineModelContext('document', modelContext)
    install()
    await flush()

    const listTool = modelContext.calls[0]!.tool
    const first = await listTool.execute({}, EXECUTE_OPTIONS)
    await listTool.execute({}, EXECUTE_OPTIONS)

    expect(JSON.parse(first)).toEqual([
      {
        slug: 'claude-api-key',
        title: 'Claude API key',
        url: `${window.location.origin}/guides/claude-api-key`,
      },
    ])
    expect(mocks.queryCollection).toHaveBeenCalledWith('keyGuides')
    expect(all).toHaveBeenCalledTimes(1)
  })

  it('navigates only to allowlisted paths with open_page', async () => {
    const modelContext = createModelContext()

    defineModelContext('document', modelContext)
    install()
    await flush()

    const openTool = modelContext.calls[2]!.tool

    await expect(openTool.execute({ path: '/signup' }, EXECUTE_OPTIONS))
      .resolves.toBe('Opened /signup.')
    expect(mocks.navigateTo).toHaveBeenCalledWith('/signup')

    mocks.navigateTo.mockClear()

    await expect(openTool.execute({ path: '/chats/new' }, EXECUTE_OPTIONS))
      .rejects.toThrow('Unsupported path')
    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })
})
