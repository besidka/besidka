// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MERMAID_MAX_TEXT_SIZE } from '@besidka/artifacts-protocol'

const peleMock = vi.hoisted(() => {
  return {
    renderAsync: vi.fn(),
  }
})

vi.mock('pele/lazy', () => {
  return { renderAsync: peleMock.renderAsync }
})

const EDGE_MESSAGE = 'Edge limit exceeded. 500 edges found, but the limit is 500.'

const EDGE_LIMIT_TEXT = 'This diagram is too large to draw: it has more than 500 connections, the limit is 500. Split it into smaller diagrams.'

async function renderBlock(source: string): Promise<HTMLElement> {
  const { createMermaidController } = await import('~~/workers/artifacts-runtime/src/kit/mermaid-view')
  const element = document.createElement('div')

  element.textContent = source
  document.body.append(element)

  const controller = createMermaidController(element)

  controller.connect()
  await vi.waitFor(() => {
    expect(element.shadowRoot?.querySelector('[data-testid="besidka-mermaid-error"]'))
      .not.toBeNull()
  })

  return element
}

function readError(element: HTMLElement) {
  return element.shadowRoot?.querySelector<HTMLElement>(
    '[data-testid="besidka-mermaid-error"]',
  ) ?? null
}

describe('besidka-mermaid limits', () => {
  beforeEach(() => {
    peleMock.renderAsync.mockReset()
    document.body.innerHTML = ''
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      callback()

      return 1
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the short message when the renderer reports the edge limit', async () => {
    peleMock.renderAsync.mockRejectedValue(new Error(EDGE_MESSAGE))

    const element = await renderBlock('flowchart TD\nA-->B')

    await vi.waitFor(() => {
      expect(readError(element)?.hidden).toBe(false)
    })
    expect(readError(element)?.textContent).toBe(EDGE_LIMIT_TEXT)
  })

  it('shows the size message for an oversized source without rendering it', async () => {
    const source = `flowchart TD\n${'A-->B\n'.repeat(MERMAID_MAX_TEXT_SIZE)}`

    const element = await renderBlock(source)

    await vi.waitFor(() => {
      expect(readError(element)?.hidden).toBe(false)
    })
    expect(readError(element)?.textContent)
      .toMatch(/^This diagram is too large to draw: its source is [\d,]+ characters, the limit is 20,000 characters\./)
    expect(peleMock.renderAsync).not.toHaveBeenCalled()
  })

  it('keeps the old wording for other render errors', async () => {
    peleMock.renderAsync.mockRejectedValue(new Error('Parse error on line 2'))

    const element = await renderBlock('bad')

    await vi.waitFor(() => {
      expect(readError(element)?.hidden).toBe(false)
    })
    expect(readError(element)?.textContent)
      .toBe('Couldn\'t render diagram: Parse error on line 2')
  })

  describe('copy and download menus', () => {
    const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'

    function readMenuLabels(element: HTMLElement, testId: string): string[] {
      const panel = element.shadowRoot?.querySelector(
        `[data-testid="${testId}-menu"]`,
      )

      return Array.from(panel?.querySelectorAll('[role="menuitem"]') ?? [])
        .map(item => item.textContent ?? '')
    }

    it('lists the chat items in the chat order, with PNG where images can be copied', async () => {
      vi.stubGlobal('ClipboardItem', { supports: () => true })
      vi.stubGlobal('navigator', { clipboard: { write: () => {} } })
      peleMock.renderAsync.mockResolvedValue({ svg: SVG })

      const element = await renderBlock('flowchart TD\nA-->B')

      expect(readMenuLabels(element, 'besidka-mermaid-copy'))
        .toEqual(['Code', 'Markdown', 'SVG', 'PNG', 'For draw.io'])
      expect(readMenuLabels(element, 'besidka-mermaid-download'))
        .toEqual(['SVG', 'PNG', '.drawio'])
    })

    it('hides the PNG copy item where images cannot be copied', async () => {
      vi.stubGlobal('ClipboardItem', undefined)
      peleMock.renderAsync.mockResolvedValue({ svg: SVG })

      const element = await renderBlock('flowchart TD\nA-->B')

      expect(readMenuLabels(element, 'besidka-mermaid-copy'))
        .toEqual(['Code', 'Markdown', 'SVG', 'For draw.io'])
    })
  })
})
