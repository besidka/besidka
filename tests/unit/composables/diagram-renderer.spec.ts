import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDiagramRenderer } from '~/composables/diagram-renderer'

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
        expect('svg' in first && first.svg).toContain('id="mermaid-first-title"')
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
})
