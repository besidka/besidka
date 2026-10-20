import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DiagramFontDescriptor,
  DiagramWorkerRequest,
  DiagramWorkerResponse,
} from '~/types/diagram.d'

type MessageListener = (event: { data: DiagramWorkerRequest }) => void

class FakeFontFace {
  static created: string[] = []
  static failingSources = new Set<string>()

  constructor(
    public family: string,
    public src: string,
  ) {
    FakeFontFace.created.push(src)
  }

  async load(): Promise<this> {
    if (FakeFontFace.failingSources.has(this.src)) {
      throw new Error('Font failed')
    }

    return this
  }
}

function createFace(
  weight: string,
  unicodeRange?: string,
): DiagramFontDescriptor {
  return {
    family: 'Nunito',
    src: `url("/_fonts/${weight}-${unicodeRange ?? 'all'}.woff2")`,
    weight,
    unicodeRange,
  }
}

describe('workers/diagram.worker', () => {
  let listeners: MessageListener[] = []
  let posted: DiagramWorkerResponse[] = []
  let addedFaces: unknown[] = []
  let requestId = 0

  async function setUpWorker(hasFonts: boolean = true): Promise<void> {
    vi.resetModules()
    vi.stubGlobal('self', {
      fonts: hasFonts
        ? { add: (face: unknown) => addedFaces.push(face) }
        : undefined,
      postMessage: (response: DiagramWorkerResponse) => posted.push(response),
      addEventListener: (_type: string, listener: MessageListener) => {
        listeners.push(listener)
      },
    })

    await import('~/workers/diagram.worker')
  }

  async function send(
    source: string,
    fonts: DiagramFontDescriptor[] = [],
  ): Promise<DiagramWorkerResponse[]> {
    const id = requestId++
    const startIndex = posted.length

    listeners[0]!({
      data: { id, source, options: { maxWidth: 600 }, fonts },
    })

    await vi.waitFor(() => {
      const messages = posted.slice(startIndex)

      expect(messages.some(message => !('status' in message))).toBe(true)
    })

    return posted.slice(startIndex)
  }

  beforeEach(() => {
    listeners = []
    posted = []
    addedFaces = []
    requestId = 0
    FakeFontFace.created = []
    FakeFontFace.failingSources.clear()
    vi.stubGlobal('FontFace', FakeFontFace)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports ready before it posts the rendered svg', async () => {
    await setUpWorker()

    const messages = await send('flowchart LR\n  A --> B')

    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({ id: 0, status: 'ready' })
    expect(messages[1]).toMatchObject({ id: 0 })
    expect('svg' in messages[1]!).toBe(true)
  })

  it('posts a positioned error for invalid syntax without a ready', async () => {
    await setUpWorker()

    const messages = await send('flowchart LR\n  A --> ')
    const failure = messages.at(-1)

    expect(failure && 'error' in failure && failure.error.line).toBeGreaterThan(0)
  })

  it('loads only the weights and ranges the source needs', async () => {
    await setUpWorker()

    const fonts = [
      createFace('400', 'U+0000-00FF'),
      createFace('700', 'U+0000-00FF'),
      createFace('900', 'U+0000-00FF'),
      createFace('400', 'U+0400-045F'),
    ]

    await send('flowchart LR\n  A[Start] --> B', fonts)

    expect(FakeFontFace.created).toEqual([fonts[0]!.src, fonts[1]!.src])
    expect(addedFaces).toHaveLength(2)
  })

  it('loads a script face when the source uses that script', async () => {
    await setUpWorker()

    const fonts = [createFace('400', 'U+0000-00FF'), createFace('400', 'U+0400-045F')]

    await send('flowchart LR\n  A[Старт] --> B', fonts)

    expect(FakeFontFace.created).toHaveLength(2)
  })

  it('loads each face once per worker', async () => {
    await setUpWorker()

    const fonts = [createFace('400', 'U+0000-00FF')]

    await send('flowchart LR\n  A --> B', fonts)
    await send('flowchart LR\n  C --> D', fonts)

    expect(FakeFontFace.created).toHaveLength(1)
  })

  it('retries a face whose load failed', async () => {
    await setUpWorker()

    const fonts = [createFace('400', 'U+0000-00FF'), createFace('700', 'U+0000-00FF')]

    FakeFontFace.failingSources.add(fonts[1]!.src)

    const first = await send('flowchart LR\n  A --> B', fonts)

    expect(first.some(message => 'svg' in message)).toBe(true)
    expect(FakeFontFace.created).toEqual([fonts[0]!.src, fonts[1]!.src])

    FakeFontFace.failingSources.clear()

    await send('flowchart LR\n  C --> D', fonts)

    expect(FakeFontFace.created).toEqual([
      fonts[0]!.src,
      fonts[1]!.src,
      fonts[1]!.src,
    ])
    expect(addedFaces).toHaveLength(2)
  })

  it('skips font loading when the worker has no font set', async () => {
    await setUpWorker(false)

    const messages = await send('flowchart LR\n  A --> B', [createFace('400')])

    expect(messages.some(message => 'svg' in message)).toBe(true)
    expect(FakeFontFace.created).toEqual([])
  })
})
