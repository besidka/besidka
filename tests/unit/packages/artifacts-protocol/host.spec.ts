import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ERROR_CODES,
  METHODS,
  PROTOCOL_VERSION,
  createEndpoint,
  createHostConnection,
} from '@besidka/artifacts-protocol'
import type {
  Endpoint,
  HostContext,
  HostFrameLike,
  HostHandlers,
} from '@besidka/artifacts-protocol'

const HOST_CONTEXT: HostContext = {
  theme: 'light',
  displayMode: 'inline',
  locale: 'en',
  capabilities: { storage: 'memory', complete: false },
}

interface FakeFrame extends HostFrameLike {
  load: () => void
  removed: boolean
  connectMessages: unknown[]
  runtimePorts: MessagePort[]
}

const openPorts: MessagePort[] = []

function createFakeFrame(): FakeFrame {
  const loadListeners = new Set<() => void>()
  const frame: FakeFrame = {
    removed: false,
    connectMessages: [],
    runtimePorts: [],
    contentWindow: {
      postMessage: (message, _targetOrigin, transfer) => {
        frame.connectMessages.push(message)
        frame.runtimePorts.push(transfer[0] as MessagePort)
        openPorts.push(transfer[0] as MessagePort)
      },
    },
    addEventListener: (_type, listener) => {
      loadListeners.add(listener)
    },
    removeEventListener: (_type, listener) => {
      loadListeners.delete(listener)
    },
    remove: () => {
      frame.removed = true
    },
    load: () => {
      for (const listener of [...loadListeners]) {
        listener()
      }
    },
  }

  return frame
}

function connectFakeRuntime(
  frame: FakeFrame,
  onNotification?: (method: string, params: unknown) => void,
): Endpoint {
  const port = frame.runtimePorts.at(-1)

  if (!port) {
    throw new Error('No runtime port')
  }

  return createEndpoint(port, { onNotification })
}

function createHandlers(overrides: Partial<HostHandlers> = {}): HostHandlers {
  return {
    getHostContext: () => {
      return HOST_CONTEXT
    },
    ...overrides,
  }
}

async function initialize(runtime: Endpoint) {
  const result = await runtime.request(METHODS.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    appCapabilities: { kinds: ['html'] },
  })

  runtime.notify(METHODS.initialized, {})

  return result
}

afterEach(() => {
  for (const port of openPorts.splice(0)) {
    port.close()
  }
})

describe('createHostConnection', () => {
  it('hands a port to the runtime on the first load and answers initialize', async () => {
    const frame = createFakeFrame()
    const onReady = vi.fn()
    const host = createHostConnection(frame, createHandlers({ onReady }))

    frame.load()

    expect(frame.connectMessages).toEqual([
      { type: 'besidka/connect', protocol: PROTOCOL_VERSION },
    ])

    const runtime = connectFakeRuntime(frame)

    await expect(initialize(runtime)).resolves.toEqual({
      protocolVersion: PROTOCOL_VERSION,
      hostContext: HOST_CONTEXT,
    })
    await vi.waitFor(() => {
      expect(onReady).toHaveBeenCalledTimes(1)
    })
    expect(host.isReady()).toBe(true)
    host.destroy()
  })

  it('queues tool results until the runtime is initialized', async () => {
    const frame = createFakeFrame()
    const host = createHostConnection(frame, createHandlers())
    const notifications: Array<[string, unknown]> = []

    host.sendToolResult({ kind: 'markdown', title: 'Doc', content: '# Hi' })
    frame.load()

    const runtime = connectFakeRuntime(frame, (method, params) => {
      notifications.push([method, params])
    })

    await initialize(runtime)
    await vi.waitFor(() => {
      expect(notifications).toEqual([[
        METHODS.toolResult,
        {
          structuredContent: { kind: 'markdown', title: 'Doc', content: '# Hi' },
        },
      ]])
    })
    host.destroy()
  })

  it('coalesces queued notifications so the latest result wins', async () => {
    const frame = createFakeFrame()
    const host = createHostConnection(frame, createHandlers())
    const notifications: Array<[string, unknown]> = []

    for (let index = 0; index < 50; index += 1) {
      host.sendToolInputPartial({
        kind: 'html',
        title: 'Draft',
        content: `<p>${index}</p>`,
      })
    }

    host.setHostContext({ theme: 'dark' })
    host.sendToolResult({ kind: 'html', title: 'Final', content: '<p>done</p>' })
    host.setHostContext({ displayMode: 'fullscreen' })
    frame.load()

    const runtime = connectFakeRuntime(frame, (method, params) => {
      notifications.push([method, params])
    })

    await initialize(runtime)
    await vi.waitFor(() => {
      expect(notifications).toHaveLength(2)
    })
    expect(notifications).toEqual([
      [
        METHODS.hostContextChanged,
        { theme: 'dark', displayMode: 'fullscreen' },
      ],
      [
        METHODS.toolResult,
        {
          structuredContent: {
            kind: 'html',
            title: 'Final',
            content: '<p>done</p>',
          },
        },
      ],
    ])
    host.destroy()
  })

  it('refuses a second initialize and another protocol version', async () => {
    const frame = createFakeFrame()
    const onInitialized = vi.fn()
    const host = createHostConnection(frame, createHandlers({ onInitialized }))

    frame.load()

    const runtime = connectFakeRuntime(frame)

    await expect(runtime.request(METHODS.initialize, {
      protocolVersion: 2,
      appCapabilities: { kinds: ['html'] },
    })).rejects.toMatchObject({ code: ERROR_CODES.invalidRequest })

    await initialize(runtime)
    await expect(initialize(runtime)).rejects.toMatchObject({
      code: ERROR_CODES.invalidRequest,
    })
    expect(onInitialized).toHaveBeenCalledTimes(1)
    host.destroy()
  })

  it('reports a runtime that never becomes ready', async () => {
    vi.useFakeTimers()

    const frame = createFakeFrame()
    const onConnectTimeout = vi.fn()
    const host = createHostConnection(
      frame,
      createHandlers({ onConnectTimeout }),
      { connectTimeoutMs: 1_000 },
    )

    frame.load()
    await vi.advanceTimersByTimeAsync(1_001)

    expect(onConnectTimeout).toHaveBeenCalledTimes(1)
    host.destroy()
    vi.useRealTimers()
  })

  it('passes a normalised link to the host', async () => {
    const frame = createFakeFrame()
    const onOpenLink = vi.fn()
    const host = createHostConnection(frame, createHandlers({ onOpenLink }))

    frame.load()

    const runtime = connectFakeRuntime(frame)

    await initialize(runtime)
    await runtime.request(METHODS.openLink, { url: 'https://EXAMPLE.com/a b' })

    expect(onOpenLink).toHaveBeenCalledWith({ url: 'https://example.com/a%20b' })
    await expect(runtime.request(METHODS.openLink, {
      url: 'https://user:pass@example.com/',
    })).rejects.toMatchObject({ code: ERROR_CODES.invalidParams })
    host.destroy()
  })

  it('answers -32601 for storage and completions without handlers', async () => {
    const frame = createFakeFrame()
    const host = createHostConnection(frame, createHandlers())

    frame.load()

    const runtime = connectFakeRuntime(frame)

    await initialize(runtime)
    await expect(runtime.request(METHODS.storageGet, { key: 'a' }))
      .rejects.toMatchObject({ code: ERROR_CODES.methodNotFound })
    await expect(runtime.request(METHODS.complete, { prompt: 'Hi' }))
      .rejects.toMatchObject({ code: ERROR_CODES.methodNotFound })
    await expect(runtime.request('besidka/unknown', {}))
      .rejects.toMatchObject({ code: ERROR_CODES.methodNotFound })
    host.destroy()
  })

  it('validates params before calling handlers', async () => {
    const frame = createFakeFrame()
    const onOpenLink = vi.fn()
    const set = vi.fn()
    const host = createHostConnection(frame, createHandlers({
      onOpenLink,
      storage: {
        get: () => {
          return { value: null }
        },
        set,
        delete: vi.fn(),
        list: () => {
          return { keys: [] }
        },
      },
    }))

    frame.load()

    const runtime = connectFakeRuntime(frame)

    await initialize(runtime)
    await expect(runtime.request(METHODS.openLink, { url: 'javascript:alert(1)' }))
      .rejects.toMatchObject({ code: ERROR_CODES.invalidParams })
    await expect(runtime.request(METHODS.storageSet, {
      key: 'a',
      value: Number.NaN,
    })).rejects.toMatchObject({ code: ERROR_CODES.invalidParams })
    expect(onOpenLink).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()

    await expect(runtime.request(METHODS.storageSet, { key: 'a', value: 1 }))
      .resolves.toEqual({})
    expect(set).toHaveBeenCalledWith({ key: 'a', value: 1 })
    host.destroy()
  })

  it('ignores invalid notifications from the runtime', async () => {
    const frame = createFakeFrame()
    const onSizeChanged = vi.fn()
    const onMessage = vi.fn()
    const host = createHostConnection(frame, createHandlers({
      onSizeChanged,
      onMessage,
    }))

    frame.load()

    const runtime = connectFakeRuntime(frame)

    await initialize(runtime)
    runtime.notify(METHODS.sizeChanged, { height: 'tall' })
    runtime.notify(METHODS.message, { level: 'debug', data: { message: 'x' } })
    runtime.notify(METHODS.sizeChanged, { height: 320 })

    await vi.waitFor(() => {
      expect(onSizeChanged).toHaveBeenCalledWith({ height: 320 })
    })
    expect(onSizeChanged).toHaveBeenCalledTimes(1)
    expect(onMessage).not.toHaveBeenCalled()
    host.destroy()
  })

  it('removes the frame and reports when the frame loads a second document', async () => {
    const frame = createFakeFrame()
    const onUnexpectedNavigation = vi.fn()
    const host = createHostConnection(frame, createHandlers({
      onUnexpectedNavigation,
    }))

    frame.load()

    const runtime = connectFakeRuntime(frame)

    await initialize(runtime)
    frame.load()

    expect(frame.removed).toBe(true)
    expect(onUnexpectedNavigation).toHaveBeenCalledWith({ loadCount: 2 })
    expect(host.isReady()).toBe(false)
    expect(frame.connectMessages).toHaveLength(1)

    host.sendToolResult({ kind: 'html', title: 'After', content: '<p>x</p>' })
    frame.load()

    expect(onUnexpectedNavigation).toHaveBeenCalledTimes(1)
  })
})
