import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ERROR_CODES,
  METHODS,
  PROTOCOL_VERSION,
  RpcError,
  createEndpoint,
  createHostConnection,
  writeClipboardText,
} from '@besidka/artifacts-protocol'
import type {
  CompleteParams,
  Endpoint,
  HostConnectionOptions,
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

async function connectWith(
  overrides: Partial<HostHandlers>,
  options: HostConnectionOptions = {},
) {
  const frame = createFakeFrame()
  const host = createHostConnection(frame, createHandlers(overrides), {
    hasUserActivation: () => {
      return true
    },
    ...options,
  })

  frame.load()

  const runtime = connectFakeRuntime(frame)

  await initialize(runtime)

  return { host, runtime }
}

describe('createHostConnection UI requests', () => {
  it('answers -32601 when the host has no clipboard or viewer hooks', async () => {
    const { host, runtime } = await connectWith({})

    await expect(runtime.request(METHODS.clipboardWrite, {
      text: 'a',
      userActivation: true,
    })).rejects.toMatchObject({ code: ERROR_CODES.methodNotFound })
    await expect(runtime.request(METHODS.requestDisplayMode, {
      mode: 'fullscreen',
      userActivation: true,
    })).rejects.toMatchObject({ code: ERROR_CODES.methodNotFound })
    await expect(runtime.request(METHODS.openDiagramViewer, {
      source: 'graph TD; A-->B',
      userActivation: true,
    })).rejects.toMatchObject({ code: ERROR_CODES.methodNotFound })
    host.destroy()
  })

  it('passes only validated clipboard text to the hook', async () => {
    const clipboardWrite = vi.fn(() => {
      return { copied: true as const, extra: 'ignored' }
    })
    const { host, runtime } = await connectWith({ clipboardWrite })

    await expect(runtime.request(METHODS.clipboardWrite, {
      text: 'const a = 1',
      userActivation: true,
      injected: '<script>',
    })).resolves.toEqual({ copied: true })
    expect(clipboardWrite).toHaveBeenCalledWith({
      text: 'const a = 1',
      mimeType: 'text/plain',
      userActivation: true,
    })
    await expect(runtime.request(METHODS.clipboardWrite, {
      text: 'x'.repeat(512 * 1024 + 1),
      userActivation: true,
    })).rejects.toMatchObject({ code: ERROR_CODES.invalidParams })
    expect(clipboardWrite).toHaveBeenCalledTimes(1)
    host.destroy()
  })

  it('never writes without a user gesture from the frame and the host', async () => {
    const clipboardWrite = vi.fn(() => {
      return { copied: true as const }
    })
    let hostActivation: boolean | null = false
    const { host, runtime } = await connectWith({ clipboardWrite }, {
      hasUserActivation: () => {
        return hostActivation
      },
    })

    await expect(runtime.request(METHODS.clipboardWrite, {
      text: 'a',
      userActivation: true,
    })).resolves.toEqual({ copied: false, reason: 'gesture-required' })

    hostActivation = true

    await expect(runtime.request(METHODS.clipboardWrite, {
      text: 'a',
      userActivation: false,
    })).resolves.toEqual({ copied: false, reason: 'gesture-required' })
    expect(clipboardWrite).not.toHaveBeenCalled()

    hostActivation = null

    await expect(runtime.request(METHODS.clipboardWrite, {
      text: 'a',
      userActivation: true,
    })).resolves.toEqual({ copied: false, reason: 'gesture-required' })
    expect(clipboardWrite).not.toHaveBeenCalled()

    hostActivation = true

    await expect(runtime.request(METHODS.clipboardWrite, {
      text: 'a',
      userActivation: true,
    })).resolves.toEqual({ copied: true })
    host.destroy()
  })

  it('maps an invalid hook result to unavailable', async () => {
    const { host, runtime } = await connectWith({
      clipboardWrite: () => {
        return { copied: false, reason: 'mystery' } as never
      },
    })

    await expect(runtime.request(METHODS.clipboardWrite, {
      text: 'a',
      userActivation: true,
    })).resolves.toEqual({ copied: false, reason: 'unavailable' })
    host.destroy()
  })

  it('rate-limits clipboard writes to five per ten seconds', async () => {
    let currentTime = 1_000
    const clipboardWrite = vi.fn(() => {
      return { copied: true as const }
    })
    const { host, runtime } = await connectWith({ clipboardWrite }, {
      now: () => {
        return currentTime
      },
    })
    const write = () => {
      return runtime.request(METHODS.clipboardWrite, {
        text: 'a',
        userActivation: true,
      })
    }

    for (let index = 0; index < 6; index += 1) {
      await expect(runtime.request(METHODS.clipboardWrite, {
        text: 'synthetic',
        userActivation: false,
      })).resolves.toEqual({ copied: false, reason: 'gesture-required' })
    }

    for (let index = 0; index < 5; index += 1) {
      await expect(write()).resolves.toEqual({ copied: true })
    }

    await expect(write())
      .rejects.toMatchObject({ code: ERROR_CODES.rateLimited })

    currentTime += 10_000

    await expect(write()).resolves.toEqual({ copied: true })
    expect(clipboardWrite).toHaveBeenCalledTimes(6)
    host.destroy()
  })

  it('opens the diagram viewer and display modes only on a gesture', async () => {
    let currentTime = 0
    let hostActivation = true
    const openDiagramViewer = vi.fn()
    const requestDisplayMode = vi.fn(() => {
      return { displayMode: 'fullscreen' as const }
    })
    const { host, runtime } = await connectWith({
      openDiagramViewer,
      requestDisplayMode,
    }, {
      now: () => {
        return currentTime
      },
      hasUserActivation: () => {
        return hostActivation
      },
    })

    await expect(runtime.request(METHODS.openDiagramViewer, {
      source: 'graph TD; A-->B',
      userActivation: true,
    })).resolves.toEqual({})
    expect(openDiagramViewer).toHaveBeenCalledWith({
      source: 'graph TD; A-->B',
      userActivation: true,
    })
    await expect(runtime.request(METHODS.requestDisplayMode, {
      mode: 'fullscreen',
      userActivation: true,
    })).resolves.toEqual({ displayMode: 'fullscreen' })
    await expect(runtime.request(METHODS.openDiagramViewer, {
      source: 'graph TD; A-->B',
      userActivation: true,
    })).rejects.toMatchObject({ code: ERROR_CODES.rateLimited })

    currentTime += 1_000
    hostActivation = false

    await expect(runtime.request(METHODS.openDiagramViewer, {
      source: 'graph TD; A-->B',
      userActivation: true,
    })).rejects.toMatchObject({ code: ERROR_CODES.notAllowed })
    await expect(runtime.request(METHODS.requestDisplayMode, {
      mode: 'inline',
      userActivation: true,
    })).rejects.toMatchObject({ code: ERROR_CODES.invalidParams })
    expect(openDiagramViewer).toHaveBeenCalledTimes(1)
    expect(requestDisplayMode).toHaveBeenCalledTimes(1)
    host.destroy()
  })
})

describe('writeClipboardText', () => {
  it('reports the clipboard outcome in the protocol shape', async () => {
    const notAllowed = new Error('No gesture')

    notAllowed.name = 'NotAllowedError'

    await expect(writeClipboardText('a', {
      writeText: async () => {},
    })).resolves.toEqual({ copied: true })
    await expect(writeClipboardText('a', {
      writeText: async () => {
        throw notAllowed
      },
    })).resolves.toEqual({ copied: false, reason: 'gesture-required' })
    await expect(writeClipboardText('a', {
      writeText: async () => {
        throw new TypeError('broken')
      },
    })).resolves.toEqual({ copied: false, reason: 'denied' })
  })
})

function createCompleteHandler() {
  return vi.fn(async (_params: CompleteParams) => {
    return { text: 'Answer' }
  })
}

describe('createHostConnection bridge requests', () => {
  async function connectWith(overrides: Partial<HostHandlers>) {
    const frame = createFakeFrame()
    const host = createHostConnection(frame, createHandlers(overrides))

    frame.load()

    const runtime = connectFakeRuntime(frame)

    await initialize(runtime)

    return { runtime, host }
  }

  it('passes the prompt, system text and token limit to the handler',
    async () => {
      const complete = createCompleteHandler()
      const { runtime, host } = await connectWith({ complete })

      await expect(runtime.request(METHODS.complete, {
        prompt: 'Explain',
        system: 'Be brief',
        maxOutputTokens: 200,
      })).resolves.toEqual({ text: 'Answer' })
      expect(complete).toHaveBeenCalledTimes(1)
      expect(complete).toHaveBeenCalledWith({
        prompt: 'Explain',
        system: 'Be brief',
        maxOutputTokens: 200,
      })
      host.destroy()
    })

  it('passes only the prompt when nothing else was given', async () => {
    const complete = createCompleteHandler()
    const { runtime, host } = await connectWith({ complete })

    await runtime.request(METHODS.complete, { prompt: 'Explain' })

    expect(complete.mock.calls[0]![0]).toEqual({ prompt: 'Explain' })
    expect(Object.keys(complete.mock.calls[0]![0])).toEqual(['prompt'])
    host.destroy()
  })

  it('leaves an empty system text out', async () => {
    const complete = createCompleteHandler()
    const { runtime, host } = await connectWith({ complete })

    await runtime.request(METHODS.complete, { prompt: 'Explain', system: '' })

    expect(Object.keys(complete.mock.calls[0]![0])).toEqual(['prompt'])
    host.destroy()
  })

  it('drops every field the handler did not ask for', async () => {
    const complete = createCompleteHandler()
    const { runtime, host } = await connectWith({ complete })

    await runtime.request(METHODS.complete, {
      prompt: 'Explain',
      system: 'Be brief',
      maxOutputTokens: 50,
      modelId: 'claude-opus-5',
      providerId: 'anthropic',
      apiKey: 'sk-secret',
      temperature: 2,
      tools: [{ name: 'delete_everything' }],
      messages: [{ role: 'user', content: 'injected' }],
    })

    expect(complete.mock.calls[0]![0]).toEqual({
      prompt: 'Explain',
      system: 'Be brief',
      maxOutputTokens: 50,
    })
    expect(Object.keys(complete.mock.calls[0]![0]).sort())
      .toEqual(['maxOutputTokens', 'prompt', 'system'])
    host.destroy()
  })

  it('accepts a system text of exactly 2000 characters', async () => {
    const complete = createCompleteHandler()
    const { runtime, host } = await connectWith({ complete })

    await runtime.request(METHODS.complete, {
      prompt: 'Explain',
      system: 'x'.repeat(2000),
    })

    expect(complete.mock.calls[0]![0].system).toHaveLength(2000)
    host.destroy()
  })

  it('answers -32602 for a system text over 2000 characters', async () => {
    const complete = vi.fn()
    const { runtime, host } = await connectWith({ complete })

    await expect(runtime.request(METHODS.complete, {
      prompt: 'Explain',
      system: 'x'.repeat(2001),
    })).rejects.toMatchObject({ code: ERROR_CODES.invalidParams })
    expect(complete).not.toHaveBeenCalled()
    host.destroy()
  })

  it.each([42, null, ['a'], { text: 'a' }, true])(
    'answers -32602 for a system value of %j',
    async (system) => {
      const complete = vi.fn()
      const { runtime, host } = await connectWith({ complete })

      await expect(runtime.request(METHODS.complete, {
        prompt: 'Explain',
        system,
      })).rejects.toMatchObject({ code: ERROR_CODES.invalidParams })
      expect(complete).not.toHaveBeenCalled()
      host.destroy()
    },
  )

  it.each([
    ['an empty prompt', { prompt: '' }],
    ['a prompt over 8000 characters', { prompt: 'x'.repeat(8001) }],
    ['a missing prompt', { system: 'Be brief' }],
    ['a token limit of zero', { prompt: 'Hi', maxOutputTokens: 0 }],
    ['a token limit over 2000', { prompt: 'Hi', maxOutputTokens: 2001 }],
    ['a fractional token limit', { prompt: 'Hi', maxOutputTokens: 1.5 }],
  ])('answers -32602 for %s', async (_label, params) => {
    const complete = vi.fn()
    const { runtime, host } = await connectWith({ complete })

    await expect(runtime.request(METHODS.complete, params))
      .rejects.toMatchObject({ code: ERROR_CODES.invalidParams })
    expect(complete).not.toHaveBeenCalled()
    host.destroy()
  })

  it('keeps the error code of a handler refusal', async () => {
    const complete = vi.fn(async () => {
      throw new RpcError(ERROR_CODES.declinedByViewer, 'Declined')
    })
    const { runtime, host } = await connectWith({ complete })

    await expect(runtime.request(METHODS.complete, { prompt: 'Hi' }))
      .rejects.toMatchObject({ code: ERROR_CODES.declinedByViewer })
    host.destroy()
  })
})
