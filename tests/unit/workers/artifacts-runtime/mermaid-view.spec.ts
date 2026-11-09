// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MERMAID_MAX_TEXT_SIZE } from '@besidka/artifacts-protocol'

const mermaidMock = vi.hoisted(() => {
  return {
    initialize: vi.fn(),
    render: vi.fn(),
  }
})

vi.mock('mermaid', () => {
  return { default: mermaidMock }
})

const EDGE_MESSAGE = 'Edge limit exceeded. 500 edges found, but the limit is 500.\n\nInitialize mermaid with maxEdges set to a higher number.'

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
    mermaidMock.initialize.mockReset()
    mermaidMock.render.mockReset()
    document.body.innerHTML = ''
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      callback()

      return 1
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the short message when Mermaid reports the edge limit', async () => {
    mermaidMock.render.mockRejectedValue(new Error(EDGE_MESSAGE))

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
      .toMatch(/^This diagram is too large to draw: its source is [\d,]+ characters, the limit is 50,000 characters\./)
    expect(mermaidMock.render).not.toHaveBeenCalled()
  })

  it('keeps the old wording for other render errors', async () => {
    mermaidMock.render.mockRejectedValue(new Error('Parse error on line 2'))

    const element = await renderBlock('bad')

    await vi.waitFor(() => {
      expect(readError(element)?.hidden).toBe(false)
    })
    expect(readError(element)?.textContent)
      .toBe('Couldn\'t render diagram: Parse error on line 2')
  })
})
