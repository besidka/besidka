import { ref } from 'vue'
import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ERROR_CODES,
  METHODS,
  PROTOCOL_VERSION,
  createEndpoint,
} from '@besidka/artifacts-protocol'
import type {
  ClipboardWriteResult,
  Endpoint,
  HostFrameLike,
  HostHandlers,
  ToolResultContent,
} from '@besidka/artifacts-protocol'
import type { SidePanelLayout } from '~/composables/side-panel'
import ChatArtifactFrame from '../../../../../app/components/Chat/Artifact/Frame.client.vue'

enableAutoUnmount(afterEach)

interface CapturedConnection {
  element: HTMLIFrameElement
  handlers: HostHandlers
  load: () => void
  runtimePort: () => MessagePort
}

const {
  captured,
  confirmMock,
  warnMock,
  colorMode,
  clipboardMock,
} = vi.hoisted(() => ({
  colorMode: { value: 'light', preference: 'light' },
  captured: [] as CapturedConnection[],
  confirmMock: vi.fn(),
  warnMock: vi.fn(),
  clipboardMock: vi.fn(),
}))

const layout = ref<SidePanelLayout>('docked')
const isFullWidth = ref<boolean>(false)
const toggleFullWidth = vi.fn(() => {
  isFullWidth.value = !isFullWidth.value
})

vi.mock('@besidka/artifacts-protocol', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@besidka/artifacts-protocol')
  >()

  return {
    ...actual,
    writeClipboardText: clipboardMock,
    createHostConnection: vi.fn((
      element: HTMLIFrameElement,
      handlers: HostHandlers,
      options: Parameters<typeof actual.createHostConnection>[2],
    ) => {
      const loadListeners = new Set<() => void>()
      const ports: MessagePort[] = []
      const fakeFrame: HostFrameLike = {
        contentWindow: {
          postMessage: (_message, _origin, transfer) => {
            ports.push(transfer[0] as MessagePort)
          },
        },
        addEventListener: (_type, listener) => {
          loadListeners.add(listener)
        },
        removeEventListener: (_type, listener) => {
          loadListeners.delete(listener)
        },
        remove: () => {
          element.remove()
        },
      }

      captured.push({
        element,
        handlers,
        load: () => {
          for (const listener of [...loadListeners]) {
            listener()
          }
        },
        runtimePort: () => {
          const port = ports.at(-1)

          if (!port) {
            throw new Error('No runtime port')
          }

          return port
        },
      })

      return actual.createHostConnection(fakeFrame, handlers, options)
    }),
  }
})

vi.mock('evlog/client', () => ({
  log: { warn: warnMock, info: vi.fn(), error: vi.fn() },
}))

mockNuxtImport('useConfirm', () => confirmMock)

mockNuxtImport('useColorMode', () => {
  return () => colorMode
})

mockNuxtImport('useSidePanelLayout', () => {
  return () => layout
})

mockNuxtImport('useSidePanel', () => {
  return () => ({ isFullWidth, toggleFullWidth })
})

mockComponent('ProseMermaidViewer', () => {
  return {
    name: 'MermaidViewerStub',
    props: ['source', 'open'],
    template: '<div data-testid="mermaid-viewer-stub" />',
  }
})

const RESULT: ToolResultContent = {
  kind: 'html',
  title: 'Landing page',
  content: '<p>v1</p>',
  artifactId: 'art_1',
  version: 1,
}

const openEndpoints: Endpoint[] = []

function connectRuntime(
  connection: CapturedConnection,
  onNotification: (method: string, params: unknown) => void = () => {},
): Endpoint {
  connection.load()

  const endpoint = createEndpoint(connection.runtimePort(), { onNotification })

  openEndpoints.push(endpoint)

  return endpoint
}

async function waitForPort() {
  await new Promise(resolve => setTimeout(resolve, 0))
  await flushPromises()
}

async function initialize(runtime: Endpoint) {
  const result = await runtime.request(METHODS.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    appCapabilities: { kinds: ['html'] },
  })

  runtime.notify(METHODS.initialized, {})
  await waitForPort()

  return result
}

async function mountFrame(props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(ChatArtifactFrame, {
    attachTo: document.body,
    props: {
      title: 'Landing page',
      result: RESULT,
      partial: null,
      artifactId: 'art_1',
      version: 1,
      ...props,
    },
  })
  const connection = captured.at(-1)

  if (!connection) {
    throw new Error('The frame did not connect')
  }

  return { wrapper, connection }
}

beforeEach(() => {
  captured.length = 0
  confirmMock.mockReset()
  warnMock.mockReset()
  clipboardMock.mockReset()
  toggleFullWidth.mockClear()
  layout.value = 'docked'
  isFullWidth.value = false
})

afterEach(() => {
  for (const endpoint of openEndpoints.splice(0)) {
    endpoint.close()
  }

  vi.useRealTimers()
})

describe('ChatArtifactFrame', () => {
  it('creates a locked-down iframe for the runtime document', async () => {
    const { connection } = await mountFrame()
    const { element } = connection

    expect(element.getAttribute('sandbox')).toBe('allow-scripts')
    expect(element.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(element.getAttribute('allow')).toBe('')
    expect(element.getAttribute('src')).toMatch(/\/v1\/index\.html$/)
    expect(element.title).toBe('Landing page preview')
    expect(element.isConnected).toBe(true)
  })

  it('adds the frame-src meta policy for the runtime origin', async () => {
    const { connection } = await mountFrame()
    const runtimeOrigin = new URL(connection.element.src).origin
    const metas = document.head.querySelectorAll(
      'meta.js-artifact-frame-policy',
    )

    expect(metas).toHaveLength(1)
    expect(metas[0]!.getAttribute('http-equiv'))
      .toBe('Content-Security-Policy')
    expect(metas[0]!.getAttribute('content')).toBe(
      `frame-src 'self' ${runtimeOrigin} https://challenges.cloudflare.com`,
    )
  })

  it('answers the handshake and shows the frame once initialized',
    async () => {
      const { wrapper, connection } = await mountFrame()
      const notifications: Array<[string, unknown]> = []
      const runtime = connectRuntime(connection, (method, params) => {
        notifications.push([method, params])
      })

      expect(wrapper.find('[data-testid="artifact-frame-loading"]').exists())
        .toBe(true)

      const result = await initialize(runtime)

      expect(result).toEqual({
        protocolVersion: PROTOCOL_VERSION,
        hostContext: {
          theme: expect.stringMatching(/^(light|dark)$/),
          displayMode: expect.stringMatching(/^(panel|fullscreen)$/),
          locale: expect.any(String),
          capabilities: { storage: 'memory', complete: false },
        },
      })
      expect(wrapper.find('[data-testid="artifact-frame-loading"]').exists())
        .toBe(false)
      expect(wrapper.emitted('ready')).toHaveLength(1)
      expect(notifications).toContainEqual([
        METHODS.toolResult,
        { structuredContent: RESULT },
      ])
    })

  it('keeps the skeleton over a ready runtime until content arrives',
    async () => {
      const { wrapper, connection } = await mountFrame({ result: null })
      const notifications: Array<[string, unknown]> = []
      const runtime = connectRuntime(connection, (method, params) => {
        notifications.push([method, params])
      })

      await initialize(runtime)

      expect(wrapper.emitted('ready')).toHaveLength(1)
      expect(wrapper.find('[data-testid="artifact-frame-loading"]').exists())
        .toBe(true)
      expect(connection.element.parentElement?.classList.contains('invisible'))
        .toBe(true)
      expect(notifications.map(([method]) => method))
        .not.toContain(METHODS.toolResult)

      await wrapper.setProps({ result: RESULT })
      await waitForPort()

      expect(wrapper.find('[data-testid="artifact-frame-loading"]').exists())
        .toBe(false)
      expect(connection.element.parentElement?.classList.contains('invisible'))
        .toBe(false)
      expect(notifications).toContainEqual([
        METHODS.toolResult,
        { structuredContent: RESULT },
      ])
    })

  it('answers unknown methods with -32601', async () => {
    const { connection } = await mountFrame()
    const runtime = connectRuntime(connection)

    await initialize(runtime)

    await expect(runtime.request(
      'besidka/unknown' as typeof METHODS.initialize,
      {} as never,
    )).rejects.toMatchObject({ code: ERROR_CODES.methodNotFound })
  })

  it('sends a new version without reloading the iframe', async () => {
    const { wrapper, connection } = await mountFrame()
    const notifications: Array<[string, unknown]> = []
    const runtime = connectRuntime(connection, (method, params) => {
      notifications.push([method, params])
    })

    await initialize(runtime)

    const nextResult = { ...RESULT, content: '<p>v2</p>', version: 2 }

    await wrapper.setProps({ result: nextResult, version: 2 })
    await waitForPort()

    expect(captured).toHaveLength(1)
    expect(connection.element.isConnected).toBe(true)
    expect(notifications).toContainEqual([
      METHODS.toolResult,
      { structuredContent: nextResult },
    ])
  })

  it('asks before opening a link and opens it without an opener',
    async () => {
      const { connection } = await mountFrame()
      const runtime = connectRuntime(connection)
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

      await initialize(runtime)
      confirmMock.mockResolvedValueOnce({ label: 'Open link', index: 0 })

      await runtime.request(METHODS.openLink, {
        url: 'https://example.com/docs',
      })

      expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
        subtitle: 'https://example.com/docs',
      }))
      expect(openSpy).toHaveBeenCalledWith(
        'https://example.com/docs',
        '_blank',
        'noopener,noreferrer',
      )
    })

  it('does not open a declined link', async () => {
    const { connection } = await mountFrame()
    const runtime = connectRuntime(connection)
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    await initialize(runtime)
    confirmMock.mockResolvedValueOnce(null)

    await runtime.request(METHODS.openLink, { url: 'https://example.com' })

    expect(openSpy).not.toHaveBeenCalled()
  })

  it('forwards runtime error messages', async () => {
    const { wrapper, connection } = await mountFrame()
    const runtime = connectRuntime(connection)

    await initialize(runtime)
    runtime.notify(METHODS.message, {
      level: 'error',
      data: { message: 'ReferenceError: x is not defined', stack: 'at x' },
    })
    await waitForPort()

    expect(wrapper.emitted('runtime-message')?.[0]).toEqual([{
      level: 'error',
      message: 'ReferenceError: x is not defined',
      stack: 'at x',
    }])
  })

  it('removes the frame after a second load and logs ids only',
    async () => {
      const { wrapper, connection } = await mountFrame()
      const runtime = connectRuntime(connection)

      await initialize(runtime)
      connection.load()
      await flushPromises()

      expect(connection.element.isConnected).toBe(false)
      expect(wrapper.find('[data-testid="artifact-frame-error"]').text())
        .toContain('The preview was stopped')
      expect(warnMock).toHaveBeenCalledWith({
        action: 'artifact-frame-navigation',
        attributes: {
          artifacts: {
            runtimeNavigation: true,
            artifactId: 'art_1',
            version: 1,
            loadCount: 2,
          },
        },
      })
    })

  it('times out after 10 seconds and retries with a fresh frame',
    async () => {
      vi.useFakeTimers()

      const { wrapper, connection } = await mountFrame()

      await vi.advanceTimersByTimeAsync(10_000)

      expect(connection.element.isConnected).toBe(false)
      expect(wrapper.find('[data-testid="artifact-frame-error"]').text())
        .toContain('did not load')

      await wrapper.get('[data-testid="artifact-frame-retry"]').trigger('click')

      expect(captured).toHaveLength(2)
      expect(captured[1]?.element.isConnected).toBe(true)
    })

  it('copies through the parent clipboard', async () => {
    const { connection } = await mountFrame()
    const runtime = connectRuntime(connection)

    await initialize(runtime)
    clipboardMock.mockResolvedValueOnce({ copied: true })

    await expect(runtime.request(METHODS.clipboardWrite, {
      text: 'const answer = 42',
      userActivation: true,
    })).resolves.toEqual({ copied: true })
    expect(clipboardMock).toHaveBeenCalledWith('const answer = 42')
  })

  it('holds a refused copy until the parent Copy button is clicked',
    async () => {
      const { wrapper, connection } = await mountFrame()
      const runtime = connectRuntime(connection)

      await initialize(runtime)
      clipboardMock
        .mockResolvedValueOnce({ copied: false, reason: 'gesture-required' })
        .mockResolvedValueOnce({ copied: true })

      let settled: ClipboardWriteResult | null = null
      const request = runtime.request(METHODS.clipboardWrite, {
        text: 'graph TD',
        userActivation: true,
      }).then((result) => {
        settled = result

        return result
      })

      await waitForPort()

      const fallback = wrapper.find('[data-testid="artifact-copy-fallback"]')

      expect(fallback.exists()).toBe(true)
      expect(fallback.text()).toContain('Copy from the artifact?')
      expect(settled).toBeNull()
      expect(clipboardMock).toHaveBeenCalledTimes(1)

      await wrapper.get('[data-testid="artifact-copy-fallback-copy"]')
        .trigger('click')

      await expect(request).resolves.toEqual({ copied: true })
      expect(clipboardMock).toHaveBeenCalledTimes(2)
      expect(clipboardMock).toHaveBeenLastCalledWith('graph TD')
      expect(wrapper.find('[data-testid="artifact-copy-fallback"]').exists())
        .toBe(false)
    })

  it('answers denied when the copy fallback is dismissed', async () => {
    const { wrapper, connection } = await mountFrame()
    const runtime = connectRuntime(connection)

    await initialize(runtime)
    clipboardMock.mockResolvedValue({
      copied: false,
      reason: 'gesture-required',
    })

    const request = runtime.request(METHODS.clipboardWrite, {
      text: 'one',
      userActivation: true,
    })

    await waitForPort()
    await wrapper.get('[data-testid="artifact-copy-fallback-dismiss"]')
      .trigger('click')

    await expect(request).resolves.toEqual({
      copied: false,
      reason: 'denied',
    })
    expect(clipboardMock).toHaveBeenCalledTimes(1)
  })

  it('dismisses the copy fallback on Escape and on a new version',
    async () => {
      const { wrapper, connection } = await mountFrame()
      const runtime = connectRuntime(connection)

      await initialize(runtime)
      clipboardMock.mockResolvedValue({
        copied: false,
        reason: 'gesture-required',
      })

      const first = runtime.request(METHODS.clipboardWrite, {
        text: 'one',
        userActivation: true,
      })

      await waitForPort()

      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })

      document.dispatchEvent(escape)

      await expect(first).resolves.toEqual({
        copied: false,
        reason: 'denied',
      })
      expect(escape.defaultPrevented).toBe(true)

      const second = runtime.request(METHODS.clipboardWrite, {
        text: 'two',
        userActivation: true,
      })

      await waitForPort()
      expect(wrapper.find('[data-testid="artifact-copy-fallback"]').exists())
        .toBe(true)

      await wrapper.setProps({
        result: { ...RESULT, content: '<p>v2</p>', version: 2 },
        version: 2,
      })

      await expect(second).resolves.toEqual({
        copied: false,
        reason: 'denied',
      })
      expect(wrapper.find('[data-testid="artifact-copy-fallback"]').exists())
        .toBe(false)
    })

  it('opens the chat diagram viewer with the received source', async () => {
    const { wrapper, connection } = await mountFrame()
    const runtime = connectRuntime(connection)

    await initialize(runtime)
    expect(wrapper.find('[data-testid="mermaid-viewer-stub"]').exists())
      .toBe(false)

    await expect(runtime.request(METHODS.openDiagramViewer, {
      source: 'graph TD\n  A --> B',
      userActivation: true,
    })).resolves.toEqual({})
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="mermaid-viewer-stub"]').exists())
        .toBe(true)
    })

    const viewer = wrapper.findComponent({ name: 'MermaidViewerStub' })

    expect(viewer.exists()).toBe(true)
    expect(viewer.props('source')).toBe('graph TD\n  A --> B')
    expect(viewer.props('open')).toBe(true)
  })

  it('switches the docked panel to full width on request', async () => {
    const { connection } = await mountFrame()
    const notifications: Array<[string, unknown]> = []
    const runtime = connectRuntime(connection, (method, params) => {
      notifications.push([method, params])
    })

    await initialize(runtime)

    await expect(runtime.request(METHODS.requestDisplayMode, {
      mode: 'fullscreen',
      userActivation: true,
    })).resolves.toEqual({ displayMode: 'fullscreen' })
    expect(toggleFullWidth).toHaveBeenCalledTimes(1)
    expect(isFullWidth.value).toBe(true)

    await waitForPort()
    expect(notifications).toContainEqual([
      METHODS.hostContextChanged,
      { displayMode: 'fullscreen' },
    ])

    await expect(runtime.request(METHODS.requestDisplayMode, {
      mode: 'panel',
      userActivation: true,
    })).resolves.toEqual({ displayMode: 'panel' })
    expect(isFullWidth.value).toBe(false)
  })

  it('keeps the bottom sheet as it is on a display mode request',
    async () => {
      layout.value = 'sheet'

      const { connection } = await mountFrame()
      const runtime = connectRuntime(connection)

      await initialize(runtime)

      await expect(runtime.request(METHODS.requestDisplayMode, {
        mode: 'panel',
        userActivation: true,
      })).resolves.toEqual({ displayMode: 'fullscreen' })
      expect(toggleFullWidth).not.toHaveBeenCalled()
    })

  it('destroys the port and the iframe on unmount', async () => {
    const { wrapper, connection } = await mountFrame()

    connectRuntime(connection)
    wrapper.unmount()

    expect(connection.element.isConnected).toBe(false)
  })
})
