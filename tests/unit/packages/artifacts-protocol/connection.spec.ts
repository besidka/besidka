import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ERROR_CODES,
  METHODS,
  RpcError,
  connectRuntime,
  createConnectMessage,
  createEndpoint,
} from '@besidka/artifacts-protocol'
import type {
  MessageListener,
  RuntimeWindowLike,
} from '@besidka/artifacts-protocol'

interface FakeWindow extends RuntimeWindowLike {
  listeners: Set<MessageListener>
  dispatch: (event: Partial<MessageEvent>) => void
}

function createFakeWindow(): FakeWindow {
  const listeners = new Set<MessageListener>()
  const fakeWindow: FakeWindow = {
    parent: {},
    listeners,
    addEventListener: (_type, listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener)
    },
    dispatch: (event) => {
      for (const listener of [...listeners]) {
        listener(event as MessageEvent)
      }
    },
  }

  return fakeWindow
}

function nextMessage(port: MessagePort): Promise<any> {
  return new Promise((resolve) => {
    port.onmessage = (event) => {
      resolve(event.data)
    }
  })
}

const openPorts: MessagePort[] = []

function createChannel() {
  const channel = new MessageChannel()

  openPorts.push(channel.port1, channel.port2)

  return channel
}

afterEach(() => {
  for (const port of openPorts.splice(0)) {
    port.close()
  }

  vi.useRealTimers()
})

describe('connectRuntime handshake', () => {
  it('accepts the first connect from window.parent that carries a port', async () => {
    const fakeWindow = createFakeWindow()
    const channel = createChannel()
    const connectionPromise = connectRuntime({ target: fakeWindow })

    fakeWindow.dispatch({
      source: fakeWindow.parent as MessageEventSource,
      data: createConnectMessage(),
      ports: [channel.port2],
    })

    const connection = await connectionPromise

    expect(fakeWindow.listeners.size).toBe(0)

    const received = nextMessage(channel.port1)

    connection.notify(METHODS.sizeChanged, { height: 42 })

    expect(await received).toEqual({
      jsonrpc: '2.0',
      method: METHODS.sizeChanged,
      params: { height: 42 },
    })
    connection.close()
  })

  it('ignores a connect from any window other than the parent', async () => {
    const fakeWindow = createFakeWindow()
    const forged = createChannel()
    const real = createChannel()
    const onResolved = vi.fn()

    connectRuntime({ target: fakeWindow }).then(onResolved)

    fakeWindow.dispatch({
      source: {} as MessageEventSource,
      data: createConnectMessage(),
      ports: [forged.port2],
    })
    await Promise.resolve()

    expect(onResolved).not.toHaveBeenCalled()
    expect(fakeWindow.listeners.size).toBe(1)

    fakeWindow.dispatch({
      source: fakeWindow.parent as MessageEventSource,
      data: createConnectMessage(),
      ports: [real.port2],
    })
    await vi.waitFor(() => {
      expect(onResolved).toHaveBeenCalledTimes(1)
    })
  })

  it('ignores connects without exactly one port or with the wrong payload', async () => {
    const fakeWindow = createFakeWindow()
    const first = createChannel()
    const second = createChannel()
    const onResolved = vi.fn()

    connectRuntime({ target: fakeWindow }).then(onResolved)

    fakeWindow.dispatch({
      source: fakeWindow.parent as MessageEventSource,
      data: createConnectMessage(),
      ports: [],
    })
    fakeWindow.dispatch({
      source: fakeWindow.parent as MessageEventSource,
      data: createConnectMessage(),
      ports: [first.port2, second.port2],
    })
    fakeWindow.dispatch({
      source: fakeWindow.parent as MessageEventSource,
      data: { type: 'besidka/connect', protocol: 99 },
      ports: [first.port2],
    })
    await Promise.resolve()

    expect(onResolved).not.toHaveBeenCalled()
  })

  it('stops listening after the first connect, so a second connect is ignored', async () => {
    const fakeWindow = createFakeWindow()
    const first = createChannel()
    const connectionPromise = connectRuntime({ target: fakeWindow })

    fakeWindow.dispatch({
      source: fakeWindow.parent as MessageEventSource,
      data: createConnectMessage(),
      ports: [first.port2],
    })
    await connectionPromise

    expect(fakeWindow.listeners.size).toBe(0)
  })

  it('refuses to connect when the runtime is the top-level window', async () => {
    const fakeWindow = createFakeWindow()
    const channel = createChannel()
    const onResolved = vi.fn()

    fakeWindow.parent = fakeWindow
    connectRuntime({ target: fakeWindow }).then(onResolved)
    fakeWindow.dispatch({
      source: fakeWindow as unknown as MessageEventSource,
      data: createConnectMessage(),
      ports: [channel.port2],
    })
    await Promise.resolve()

    expect(onResolved).not.toHaveBeenCalled()
  })
})

describe('createEndpoint', () => {
  it('answers -32601 when no request handler exists', async () => {
    const channel = createChannel()
    const requester = createEndpoint(channel.port1)

    createEndpoint(channel.port2)

    await expect(requester.request('besidka/storage/get', { key: 'a' }))
      .rejects.toMatchObject({ code: ERROR_CODES.methodNotFound })
  })

  it('relays results and RpcError codes from the handler', async () => {
    const channel = createChannel()
    const requester = createEndpoint(channel.port1)

    createEndpoint(channel.port2, {
      onRequest: (method) => {
        if (method === 'ok') {
          return { value: 1 }
        }

        throw new RpcError(ERROR_CODES.consentRequired, 'Consent needed')
      },
    })

    await expect(requester.request('ok', {})).resolves.toEqual({ value: 1 })
    await expect(requester.request('refuse', {})).rejects.toMatchObject({
      code: ERROR_CODES.consentRequired,
      message: 'Consent needed',
    })
  })

  it('hides internal error details from the other side', async () => {
    const channel = createChannel()
    const requester = createEndpoint(channel.port1)

    createEndpoint(channel.port2, {
      onRequest: () => {
        throw new Error('database password is hunter2')
      },
    })

    await expect(requester.request('boom', {})).rejects.toMatchObject({
      code: ERROR_CODES.internalError,
      message: 'Internal error',
    })
  })

  it('times out unanswered requests', async () => {
    vi.useFakeTimers()

    const channel = createChannel()
    const requester = createEndpoint(channel.port1, { timeoutMs: 1_000 })
    const pending = requester.request('never', {})
    const assertion = expect(pending).rejects.toMatchObject({
      code: ERROR_CODES.requestTimeout,
    })

    await vi.advanceTimersByTimeAsync(1_001)
    await assertion
  })

  it('rejects pending requests when closed', async () => {
    const channel = createChannel()
    const requester = createEndpoint(channel.port1)
    const pending = requester.request('never', {})

    requester.close()

    await expect(pending).rejects.toMatchObject({
      code: ERROR_CODES.connectionClosed,
    })
    await expect(requester.request('after-close', {})).rejects.toMatchObject({
      code: ERROR_CODES.connectionClosed,
    })
  })
})
