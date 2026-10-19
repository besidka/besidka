import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDiagramRenderer } from '~/composables/diagram-renderer'
import type {
  DiagramRenderResult,
  DiagramWorkerRequest,
  DiagramWorkerResponse,
} from '~/types/diagram.d'

class FakeWorker {
  static instances: FakeWorker[] = []

  onmessage: ((event: { data: DiagramWorkerResponse }) => void) | null = null
  onerror: ((event: { preventDefault: () => void }) => void) | null = null
  onmessageerror: (() => void) | null = null
  posted: DiagramWorkerRequest[] = []
  isTerminated: boolean = false
  static postError: Error | null = null

  constructor(
    public url: URL,
    public options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this)
  }

  postMessage(message: DiagramWorkerRequest): void {
    if (FakeWorker.postError) {
      throw FakeWorker.postError
    }

    this.posted.push(message)
  }

  terminate(): void {
    this.isTerminated = true
  }

  reply(response: DiagramWorkerResponse): void {
    this.onmessage?.({ data: response })
  }

  ready(index: number = 0): void {
    this.reply({ id: this.posted[index]!.id, status: 'ready' })
  }

  fail(): void {
    this.onerror?.({ preventDefault: () => {} })
  }
}

const mocks = vi.hoisted(() => {
  return {
    renderAsync: vi.fn(),
  }
})

vi.mock('pele/lazy', async () => {
  const actual = await vi.importActual<typeof import('pele/lazy')>(
    'pele/lazy',
  )

  return { ...actual, renderAsync: mocks.renderAsync }
})

describe('useDiagramRenderer', () => {
  const { renderDiagram } = useDiagramRenderer()

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('pele/lazy')>(
      'pele/lazy',
    )

    mocks.renderAsync.mockReset()
    mocks.renderAsync.mockImplementation(actual.renderAsync)
  })

  it('renders a valid flowchart to an svg string', async () => {
    const result = await renderDiagram(
      'flowchart LR\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Done]',
    )

    expect('svg' in result).toBe(true)

    if ('svg' in result) {
      expect(result.svg).toContain('<svg')
      expect(result.svg).toContain('Start')
    }
  })

  it('returns a positioned error for invalid syntax', async () => {
    const result = await renderDiagram('flowchart LR\n  A --> ')

    expect('error' in result).toBe(true)

    if ('error' in result) {
      expect(result.error.message).not.toBe('')
      expect(result.error.line).toBeGreaterThan(0)
      expect(result.error.column).toBeGreaterThan(0)
    }
  })

  it('returns an error without a position for an unknown diagram', async () => {
    const result = await renderDiagram('foo bar')

    expect('error' in result).toBe(true)

    if ('error' in result) {
      expect(result.error.message).not.toBe('')
      expect(result.error.line).toBeUndefined()
      expect(result.error.column).toBeUndefined()
    }
  })

  it('never throws on empty or oversized input', async () => {
    await expect(renderDiagram('')).resolves.toHaveProperty('error')
    await expect(
      renderDiagram(`flowchart LR\n${'  A --> B\n'.repeat(5000)}`),
    ).resolves.toHaveProperty('error')
  })

  it('escapes script content from diagram labels', async () => {
    const result = await renderDiagram(
      'flowchart LR\n  A["<script>alert(1)</script>"] --> B',
    )

    expect('svg' in result).toBe(true)

    if ('svg' in result) {
      expect(result.svg).not.toContain('<script')
    }
  })

  it('drops links and images from diagrams', async () => {
    const result = await renderDiagram(
      'flowchart LR\n  A --> B\n  click A "https://example.com"',
    )

    expect('svg' in result).toBe(true)

    if ('svg' in result) {
      expect(result.svg).not.toContain('<a ')
      expect(result.svg).not.toContain('<image')
    }
  })

  describe('flowchart direction', () => {
    const branchingSource = [
      'flowchart LR',
      '  Browser --> Worker --> K{KV hit?}',
      '  K -- yes --> Response',
      '  K -- no --> D[(D1)] --> Response',
    ].join('\n')

    function getViewBoxSize(result: DiagramRenderResult) {
      const svg = 'svg' in result ? result.svg : ''
      const viewBox = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(svg)

      return {
        width: Number(viewBox?.[1]),
        height: Number(viewBox?.[2]),
      }
    }

    it('keeps the declared left-to-right direction at desktop widths',
      async () => {
        const { renderDiagram } = useDiagramRenderer()
        const { width, height } = getViewBoxSize(
          await renderDiagram(branchingSource, { maxWidth: 600 }),
        )

        expect(width).toBeGreaterThan(height)
      })

    it('still renders at phone widths', async () => {
      const { renderDiagram } = useDiagramRenderer()
      const result = await renderDiagram(branchingSource, { maxWidth: 360 })

      expect('svg' in result).toBe(true)
    })
  })

  describe('render cache', () => {
    const titledSource = 'flowchart LR\n  accTitle: Cached\n  A --> B'

    it('renders the same input once and serves repeats from the cache',
      async () => {
        const source = 'flowchart LR\n  CacheHitA --> CacheHitB'

        const first = await renderDiagram(source, { maxWidth: 400 })
        const second = await renderDiagram(source, { maxWidth: 400 })

        expect(mocks.renderAsync).toHaveBeenCalledTimes(1)
        expect(second).toEqual(first)
      })

    it('renders again when the width differs', async () => {
      const source = 'flowchart LR\n  WidthA --> WidthB'

      await renderDiagram(source, { maxWidth: 400 })
      await renderDiagram(source, { maxWidth: 800 })

      expect(mocks.renderAsync).toHaveBeenCalledTimes(2)
    })

    it('does not cache errors', async () => {
      const source = 'flowchart LR\n  ErrorA --> '

      await renderDiagram(source)
      await renderDiagram(source)

      expect(mocks.renderAsync).toHaveBeenCalledTimes(2)
    })

    it('gives each id prefix its own ids when served from the cache',
      async () => {
        const first = await renderDiagram(titledSource, {
          idPrefix: 'mermaid-first',
        })
        const second = await renderDiagram(titledSource, {
          idPrefix: 'mermaid-second',
        })

        expect(mocks.renderAsync).toHaveBeenCalledTimes(1)
        expect('svg' in first && first.svg)
          .toContain('id="mermaid-first-title"')
        expect('svg' in second && second.svg)
          .toContain('id="mermaid-second-title"')
        expect('svg' in second && second.svg).not.toContain('mermaid-first')
      })

    it('evicts the oldest entry once the cache is full', async () => {
      const oldest = 'flowchart LR\n  EvictionOldest --> B'

      await renderDiagram(oldest)

      for (let index = 0; index < 50; index++) {
        await renderDiagram(`flowchart LR\n  Filler${index} --> B`)
      }

      mocks.renderAsync.mockClear()

      await renderDiagram(oldest)

      expect(mocks.renderAsync).toHaveBeenCalledTimes(1)
    })
  })

  describe('worker rendering', () => {
    const timeoutMessage = 'Diagram took too long to render'
    const prepareMessage = 'Diagram renderer took too long to start'
    const failureMessage = 'Diagram renderer failed'
    const prefixedSvg = '<svg id="diagram-render-cache-prefix-title"></svg>'

    async function importRenderer() {
      vi.resetModules()

      const module = await import('~/composables/diagram-renderer')

      return module.useDiagramRenderer().renderDiagram
    }

    function getSvg(result: DiagramRenderResult): string {
      return 'svg' in result ? result.svg : ''
    }

    function addFontStyle(weight: string, url: string): void {
      const style = document.createElement('style')

      style.textContent = '@font-face { font-family: "Nunito"; '
        + `src: url("${url}") format("woff2"); font-weight: ${weight}; }`
      document.head.appendChild(style)
    }

    beforeEach(() => {
      FakeWorker.instances = []
      FakeWorker.postError = null
      vi.stubGlobal('Worker', FakeWorker)
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllGlobals()
      document.head.querySelectorAll('style').forEach((style) => {
        style.remove()
      })
    })

    it('spawns one module worker and resolves the posted render',
      async () => {
        const renderWithWorker = await importRenderer()
        const pending = renderWithWorker('flowchart LR\n  A --> B', {
          maxWidth: 320,
        })
        const [worker] = FakeWorker.instances

        expect(FakeWorker.instances).toHaveLength(1)
        expect(worker?.options).toEqual({ type: 'module' })
        expect(worker?.url.pathname).toMatch(/diagram\.worker\.ts$/)
        expect(worker?.posted).toHaveLength(1)
        expect(worker?.posted[0]).toMatchObject({
          source: 'flowchart LR\n  A --> B',
          options: { maxWidth: 320 },
        })

        worker?.ready()
        worker?.reply({ id: worker.posted[0]!.id, svg: prefixedSvg })

        expect(getSvg(await pending)).toBe('<svg id="pele-title"></svg>')
        expect(mocks.renderAsync).not.toHaveBeenCalled()
      })

    it('caches worker results so repeats never post again', async () => {
      const renderWithWorker = await importRenderer()
      const source = 'flowchart LR\n  A --> B'
      const first = renderWithWorker(source, { idPrefix: 'first' })
      const [worker] = FakeWorker.instances

      worker?.reply({ id: worker.posted[0]!.id, svg: prefixedSvg })

      expect(getSvg(await first)).toBe('<svg id="first-title"></svg>')

      const second = await renderWithWorker(source, { idPrefix: 'second' })

      expect(getSvg(second)).toBe('<svg id="second-title"></svg>')
      expect(worker?.posted).toHaveLength(1)
    })

    it('returns worker errors without caching them', async () => {
      const renderWithWorker = await importRenderer()
      const first = renderWithWorker('flowchart LR\n  A --> ')
      const [worker] = FakeWorker.instances

      worker?.reply({
        id: worker.posted[0]!.id,
        error: { message: 'Bad syntax', line: 2, column: 8 },
      })

      await expect(first).resolves.toEqual({
        error: { message: 'Bad syntax', line: 2, column: 8 },
      })

      const second = renderWithWorker('flowchart LR\n  A --> ')

      expect(worker?.posted).toHaveLength(2)

      worker?.reply({
        id: worker.posted[1]!.id,
        error: { message: 'Bad syntax' },
      })

      await second
    })

    it('starts the render timer only once the worker reports ready',
      async () => {
        vi.useFakeTimers()

        const renderWithWorker = await importRenderer()
        const pending = renderWithWorker('flowchart LR\n  Slow --> B')
        const [worker] = FakeWorker.instances

        await vi.advanceTimersByTimeAsync(10_000)

        expect(worker?.isTerminated).toBe(false)

        worker?.ready()

        await vi.advanceTimersByTimeAsync(2999)

        expect(worker?.isTerminated).toBe(false)

        await vi.advanceTimersByTimeAsync(1)

        await expect(pending).resolves.toEqual({
          error: { message: timeoutMessage },
        })
        expect(worker?.isTerminated).toBe(true)
      })

    it('spawns a fresh worker after a render timeout', async () => {
      vi.useFakeTimers()

      const renderWithWorker = await importRenderer()
      const pending = renderWithWorker('flowchart LR\n  Slow --> B')
      const [stuckWorker] = FakeWorker.instances

      stuckWorker?.ready()

      await vi.advanceTimersByTimeAsync(3000)
      await pending

      const next = renderWithWorker('flowchart LR\n  Fast --> B')

      expect(FakeWorker.instances).toHaveLength(2)

      const freshWorker = FakeWorker.instances[1]

      freshWorker?.reply({
        id: freshWorker.posted[0]!.id,
        svg: '<svg></svg>',
      })

      await expect(next).resolves.toEqual({ svg: '<svg></svg>' })
      expect(stuckWorker?.posted).toHaveLength(1)
    })

    it('gives up on a worker that never becomes ready', async () => {
      vi.useFakeTimers()

      const renderWithWorker = await importRenderer()
      const source = 'flowchart LR\n  Hung --> B'
      const pending = renderWithWorker(source)
      const [worker] = FakeWorker.instances

      await vi.advanceTimersByTimeAsync(14_999)

      expect(worker?.isTerminated).toBe(false)

      await vi.advanceTimersByTimeAsync(1)

      await expect(pending).resolves.toEqual({
        error: { message: prepareMessage },
      })
      expect(worker?.isTerminated).toBe(true)

      const retry = renderWithWorker(source)

      expect(FakeWorker.instances).toHaveLength(2)

      FakeWorker.instances[1]?.reply({
        id: FakeWorker.instances[1].posted[0]!.id,
        svg: '<svg></svg>',
      })

      await expect(retry).resolves.toEqual({ svg: '<svg></svg>' })
    })

    it('answers a known-hanging diagram with the timeout error at once',
      async () => {
        vi.useFakeTimers()

        const renderWithWorker = await importRenderer()
        const source = 'flowchart LR\n  Hang --> B'
        const first = renderWithWorker(source)

        FakeWorker.instances[0]?.ready()

        await vi.advanceTimersByTimeAsync(3000)
        await first

        const second = await renderWithWorker(source)

        expect(second).toEqual({ error: { message: timeoutMessage } })
        expect(FakeWorker.instances).toHaveLength(1)
        expect(FakeWorker.instances[0]?.posted).toHaveLength(1)
      })

    it('fails the active request on a worker error and recreates it',
      async () => {
        const renderWithWorker = await importRenderer()
        const pending = renderWithWorker('flowchart LR\n  Crash --> B')
        const [crashedWorker] = FakeWorker.instances

        crashedWorker?.fail()

        await expect(pending).resolves.toEqual({
          error: { message: failureMessage },
        })
        expect(crashedWorker?.isTerminated).toBe(true)

        const next = renderWithWorker('flowchart LR\n  Again --> B')

        expect(FakeWorker.instances).toHaveLength(2)

        const freshWorker = FakeWorker.instances[1]

        freshWorker?.reply({
          id: freshWorker.posted[0]!.id,
          svg: '<svg></svg>',
        })

        await expect(next).resolves.toEqual({ svg: '<svg></svg>' })
      })

    it('fails the active request on a message error', async () => {
      const renderWithWorker = await importRenderer()
      const pending = renderWithWorker('flowchart LR\n  Clone --> B')
      const [worker] = FakeWorker.instances

      worker?.onmessageerror?.()

      await expect(pending).resolves.toEqual({
        error: { message: failureMessage },
      })
      expect(worker?.isTerminated).toBe(true)
    })

    it('fails the request when postMessage throws', async () => {
      FakeWorker.postError = new DOMException('Not cloneable', 'DataCloneError')

      const renderWithWorker = await importRenderer()
      const result = await renderWithWorker('flowchart LR\n  Clone --> B')

      expect(result).toEqual({ error: { message: failureMessage } })
      expect(FakeWorker.instances[0]?.isTerminated).toBe(true)
    })

    it('ignores replies for requests that are no longer active', async () => {
      vi.useFakeTimers()

      const renderWithWorker = await importRenderer()
      const timedOut = renderWithWorker('flowchart LR\n  Late --> B')
      const [staleWorker] = FakeWorker.instances
      const staleHandler = staleWorker!.onmessage!
      const staleId = staleWorker!.posted[0]!.id

      staleWorker?.ready()

      await vi.advanceTimersByTimeAsync(3000)
      await timedOut

      const next = renderWithWorker('flowchart LR\n  Next --> B')
      const freshWorker = FakeWorker.instances[1]!

      staleHandler({ data: { id: staleId, svg: '<svg id="stale"></svg>' } })
      staleHandler({ data: { id: staleId, status: 'ready' } })
      freshWorker.reply({
        id: freshWorker.posted[0]!.id,
        svg: '<svg id="fresh"></svg>',
      })

      expect(getSvg(await next)).toBe('<svg id="fresh"></svg>')
    })

    it('renders one request at a time and times each separately',
      async () => {
        vi.useFakeTimers()

        const renderWithWorker = await importRenderer()
        const first = renderWithWorker('flowchart LR\n  First --> B')
        const second = renderWithWorker('flowchart LR\n  Second --> B')
        const [worker] = FakeWorker.instances

        expect(worker?.posted).toHaveLength(1)

        worker?.ready(0)

        await vi.advanceTimersByTimeAsync(2000)

        worker?.reply({ id: worker.posted[0]!.id, svg: '<svg id="1"></svg>' })

        expect(getSvg(await first)).toBe('<svg id="1"></svg>')
        expect(worker?.posted).toHaveLength(2)
        expect(worker?.posted[1]?.source).toContain('Second')

        worker?.ready(1)

        await vi.advanceTimersByTimeAsync(2000)

        expect(worker?.isTerminated).toBe(false)

        worker?.reply({ id: worker.posted[1]!.id, svg: '<svg id="2"></svg>' })

        expect(getSvg(await second)).toBe('<svg id="2"></svg>')
        expect(FakeWorker.instances).toHaveLength(1)
      })

    it('continues the queue after a timeout', async () => {
      vi.useFakeTimers()

      const renderWithWorker = await importRenderer()
      const slow = renderWithWorker('flowchart LR\n  Slow --> B')
      const queued = renderWithWorker('flowchart LR\n  Queued --> B')

      FakeWorker.instances[0]?.ready()

      await vi.advanceTimersByTimeAsync(3000)

      await expect(slow).resolves.toEqual({
        error: { message: timeoutMessage },
      })
      expect(FakeWorker.instances).toHaveLength(2)

      const freshWorker = FakeWorker.instances[1]!

      expect(freshWorker.posted[0]?.source).toContain('Queued')

      freshWorker.reply({
        id: freshWorker.posted[0]!.id,
        svg: '<svg></svg>',
      })

      await expect(queued).resolves.toEqual({ svg: '<svg></svg>' })
    })

    it('shares one post between concurrent callers of the same diagram',
      async () => {
        const renderWithWorker = await importRenderer()
        const source = 'flowchart LR\n  Shared --> B'
        const first = renderWithWorker(source, { idPrefix: 'one' })
        const second = renderWithWorker(source, { idPrefix: 'two' })
        const [worker] = FakeWorker.instances

        expect(worker?.posted).toHaveLength(1)

        worker?.reply({ id: worker.posted[0]!.id, svg: prefixedSvg })

        expect(getSvg(await first)).toBe('<svg id="one-title"></svg>')
        expect(getSvg(await second)).toBe('<svg id="two-title"></svg>')
        expect(worker?.posted).toHaveLength(1)
      })

    it('drops the oldest waiting requests once the queue is full',
      async () => {
        const renderWithWorker = await importRenderer()
        const results: Promise<DiagramRenderResult>[] = []

        for (let index = 0; index < 22; index++) {
          results.push(renderWithWorker(`flowchart LR\n  Queue${index} --> B`))
        }

        const [worker] = FakeWorker.instances

        expect(worker?.posted).toHaveLength(1)
        await expect(results[1]).resolves.toEqual({
          error: { message: 'Too many diagrams queued' },
        })

        worker?.reply({ id: worker.posted[0]!.id, svg: '<svg></svg>' })
        await results[0]

        expect(worker?.posted).toHaveLength(2)
        expect(worker?.posted[1]?.source).toContain('Queue2')
      })

    it('sends the diagram font descriptors with each message', async () => {
      addFontStyle('400', '/_fonts/nunito.woff2')
      document.head.querySelector('style')!.textContent
        += '@font-face { font-family: "Other"; src: url("/_fonts/other.woff2"); }'

      const renderWithWorker = await importRenderer()
      const first = renderWithWorker('flowchart LR\n  A --> B')
      const [worker] = FakeWorker.instances
      const expectedFonts = [
        {
          family: 'Nunito',
          src: `url("${location.origin}/_fonts/nunito.woff2") format("woff2")`,
          weight: '400',
          style: undefined,
          unicodeRange: undefined,
        },
      ]

      expect(worker?.posted[0]?.fonts).toEqual(expectedFonts)

      worker?.reply({ id: worker.posted[0]!.id, svg: '<svg></svg>' })
      await first

      const second = renderWithWorker('flowchart LR\n  C --> D')

      expect(worker?.posted[1]?.fonts).toEqual(expectedFonts)

      worker?.reply({ id: worker.posted[1]!.id, svg: '<svg></svg>' })
      await second
    })

    it('re-collects the fonts when the stylesheet count changes',
      async () => {
        const renderWithWorker = await importRenderer()
        const first = renderWithWorker('flowchart LR\n  A --> B')
        const [worker] = FakeWorker.instances

        expect(worker?.posted[0]?.fonts).toEqual([])

        worker?.reply({ id: worker.posted[0]!.id, svg: '<svg></svg>' })
        await first

        addFontStyle('700', '/_fonts/nunito-bold.woff2')

        const second = renderWithWorker('flowchart LR\n  C --> D')

        expect(worker?.posted[1]?.fonts).toHaveLength(1)
        expect(worker?.posted[1]?.fonts[0]?.weight).toBe('700')

        worker?.reply({ id: worker.posted[1]!.id, svg: '<svg></svg>' })
        await second
      })

    it('falls back to in-thread rendering when the worker cannot be built',
      async () => {
        vi.stubGlobal('Worker', function BlockedWorker() {
          throw new Error('Worker blocked')
        })

        const renderWithWorker = await importRenderer()
        const result = await renderWithWorker('flowchart LR\n  A --> B')

        expect(getSvg(result)).toContain('<svg')
        expect(FakeWorker.instances).toHaveLength(0)
      })
  })
})
