import {
  createConnectMessage,
  createHostConnection,
  ERROR_CODES,
  RpcError,
  writeClipboardText,
} from '@besidka/artifacts-protocol'
import type {
  ArtifactPayload,
  ClipboardWriteParams,
  ClipboardWriteResult,
  HostConnection,
  JsonValue,
  LogMessageParams,
  Theme,
} from '@besidka/artifacts-protocol'

type ClipboardMode = 'write' | 'deny' | 'fallback' | 'absent'

interface MountOptions {
  storage?: boolean
  complete?: boolean
  theme?: Theme
  clipboard?: ClipboardMode
  viewer?: boolean
}

interface HarnessState {
  initialized: boolean
  ready: boolean
  loads: number
  sizes: number[]
  messages: LogMessageParams[]
  links: string[]
  navigations: number
  frameRemoved: boolean
  storage: Record<string, JsonValue>
  storageWrites: Array<{ key: string, value: JsonValue, receivedAt: number }>
  completePrompts: string[]
  clipboardWrites: Array<{ text: string, result: ClipboardWriteResult }>
  diagramViews: string[]
}

declare global {
  interface Window {
    harness: ReturnType<typeof createHarness>
  }
}

const RUNTIME_URL = `${new URLSearchParams(location.search).get('runtime') ?? document.body.dataset.runtimeOrigin ?? 'http://127.0.0.1:8788'}/v1/index.html`

function createInitialState(): HarnessState {
  return {
    initialized: false,
    ready: false,
    loads: 0,
    sizes: [],
    messages: [],
    links: [],
    navigations: 0,
    frameRemoved: false,
    storage: {},
    storageWrites: [],
    completePrompts: [],
    clipboardWrites: [],
    diagramViews: [],
  }
}

const REFUSING_CLIPBOARD = {
  writeText: async () => {
    const exception = new Error('Write permission denied.')

    exception.name = 'NotAllowedError'
    throw exception
  },
}

function waitForHostCopyClick(text: string): Promise<ClipboardWriteResult> {
  return new Promise((resolve) => {
    const button = document.createElement('button')

    button.type = 'button'
    button.className = 'js-host-copy-fallback'
    button.textContent = 'Copy from artifact'
    button.dataset.testid = 'host-copy-fallback'
    button.addEventListener('click', async () => {
      button.remove()
      resolve(await writeClipboardText(text))
    }, { once: true })
    document.body.prepend(button)
  })
}

async function writeForMode(
  mode: ClipboardMode,
  params: ClipboardWriteParams,
): Promise<ClipboardWriteResult> {
  if (mode === 'deny') {
    return { copied: false, reason: 'denied' }
  }

  if (mode === 'write') {
    return writeClipboardText(params.text)
  }

  const firstAttempt = await writeClipboardText(
    params.text,
    REFUSING_CLIPBOARD,
  )

  if (firstAttempt.copied || firstAttempt.reason !== 'gesture-required') {
    return firstAttempt
  }

  return waitForHostCopyClick(params.text)
}

function createFrame(): HTMLIFrameElement {
  const frame = document.createElement('iframe')

  frame.setAttribute('sandbox', 'allow-scripts')
  frame.title = 'Artifact'
  frame.dataset.testid = 'artifact-frame'
  frame.style.width = '800px'
  frame.style.height = '600px'
  frame.src = RUNTIME_URL

  return frame
}

const SIBLING_DOCUMENT = [
  '<!doctype html><title>sibling</title><script>',
  'const channel = new MessageChannel();',
  'channel.port1.onmessage = (event) => {',
  '  parent.harness.probes.forgedSibling.push(String(event.data && event.data.method || "response"));',
  '};',
  'parent.frames[0].postMessage({ type: "besidka/connect", protocol: 1 }, "*", [channel.port2]);',
  'parent.harness.probes.siblingPosted = true;',
  '</script>',
].join('')

function createHarness() {
  const probes = {
    forgedSibling: [] as string[],
    siblingPosted: false,
    secondConnect: [] as string[],
    manual: [] as string[],
  }
  let state = createInitialState()
  let connection: HostConnection | null = null
  let frame: HTMLIFrameElement | null = null
  let theme: Theme = 'light'

  function reset() {
    document.querySelector('.js-host-copy-fallback')?.remove()
    connection?.destroy()
    connection = null
    frame?.remove()
    state = createInitialState()
    probes.forgedSibling.length = 0
    probes.secondConnect.length = 0
    probes.manual.length = 0
    probes.siblingPosted = false
  }

  function mount(options: MountOptions = {}) {
    reset()
    theme = options.theme ?? 'light'
    frame = createFrame()

    const currentFrame = frame

    currentFrame.addEventListener('load', () => {
      state.loads += 1
    })

    connection = createHostConnection(currentFrame, {
      getHostContext: () => {
        return {
          theme,
          displayMode: 'panel',
          locale: 'en',
          capabilities: {
            storage: options.storage ? 'persistent' : 'memory',
            complete: Boolean(options.complete),
          },
        }
      },
      onInitialized: () => {
        state.initialized = true
      },
      onReady: () => {
        state.ready = true
      },
      onSizeChanged: (params) => {
        state.sizes.push(params.height)
      },
      onMessage: (params) => {
        state.messages.push(params)
      },
      onOpenLink: (params) => {
        state.links.push(params.url)
      },
      onUnexpectedNavigation: () => {
        state.navigations += 1
        state.frameRemoved = !currentFrame.isConnected
      },
      storage: options.storage
        ? {
          get: ({ key }) => {
            return { value: state.storage[key] ?? null }
          },
          set: ({ key, value }) => {
            state.storage[key] = value
            state.storageWrites.push({ key, value, receivedAt: Date.now() })
          },
          delete: ({ key }) => {
            Reflect.deleteProperty(state.storage, key)
          },
          list: ({ prefix }) => {
            return {
              keys: Object.keys(state.storage).filter((key) => {
                return !prefix || key.startsWith(prefix)
              }),
            }
          },
        }
        : undefined,
      complete: options.complete
        ? ({ prompt }) => {
          state.completePrompts.push(prompt)

          if (prompt === 'decline') {
            throw new RpcError(ERROR_CODES.declinedByViewer, 'Declined')
          }

          return { text: `echo: ${prompt}` }
        }
        : undefined,
      clipboardWrite: options.clipboard && options.clipboard !== 'absent'
        ? async (params) => {
          const result = await writeForMode(
            options.clipboard as ClipboardMode,
            params,
          )

          state.clipboardWrites.push({ text: params.text, result })

          return result
        }
        : undefined,
      openDiagramViewer: options.viewer
        ? ({ source }) => {
          state.diagramViews.push(source)
        }
        : undefined,
    })

    document.body.append(currentFrame)
  }

  function mountUnconnected() {
    reset()
    frame = createFrame()
    frame.addEventListener('load', () => {
      state.loads += 1
    })
    document.body.append(frame)
  }

  function sendConnect(port: MessagePort) {
    frame?.contentWindow?.postMessage(createConnectMessage(), '*', [port])
  }

  function connectWithProbe(bucket: string[]) {
    const channel = new MessageChannel()

    channel.port1.onmessage = (event) => {
      bucket.push(String(event.data?.method ?? 'response'))
    }
    sendConnect(channel.port2)
  }

  return {
    mount,
    mountUnconnected,
    probes,
    get state() {
      return state
    },
    get frame() {
      return frame
    },
    sendResult(payload: ArtifactPayload & { version?: number }) {
      connection?.sendToolResult(payload)
    },
    sendPartial(payload: ArtifactPayload) {
      connection?.sendToolInputPartial(payload)
    },
    setTheme(nextTheme: Theme) {
      theme = nextTheme
      connection?.setHostContext({ theme: nextTheme })
    },
    forgeConnectFromSibling() {
      const sibling = document.createElement('iframe')

      sibling.srcdoc = SIBLING_DOCUMENT
      document.body.append(sibling)
    },
    forgeSecondConnect() {
      connectWithProbe(probes.secondConnect)
    },
    connectManually() {
      connectWithProbe(probes.manual)
    },
  }
}

window.harness = createHarness()
document.body.dataset.harnessReady = 'true'
