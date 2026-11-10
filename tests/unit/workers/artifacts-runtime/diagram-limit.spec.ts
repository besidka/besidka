// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DIAGRAM_RENDER_OPTIONS,
  MERMAID_MAX_EDGES,
  MERMAID_MAX_TEXT_SIZE,
} from '@besidka/artifacts-protocol'
import type { ArtifactPayload, Theme } from '@besidka/artifacts-protocol'

const peleMock = vi.hoisted(() => {
  return {
    renderAsync: vi.fn(),
  }
})

vi.mock('pele/lazy', () => {
  return { renderAsync: peleMock.renderAsync }
})

const EDGE_MESSAGE = 'Edge limit exceeded. 500 edges found, but the limit is 500.'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'

async function loadModules() {
  const { renderMermaid } = await import('~~/workers/artifacts-runtime/src/render/mermaid')
  const { DiagramLimitError } = await import('~~/workers/artifacts-runtime/src/render/diagram-limit')
  const report = await import('~~/workers/artifacts-runtime/src/report')

  return { renderMermaid, DiagramLimitError, report }
}

function createContext(root: HTMLElement) {
  return { root, theme: 'light' as Theme, isCurrent: () => true }
}

function createPayload(content: string): ArtifactPayload {
  return { kind: 'mermaid', title: 'Diagram', content }
}

describe('mermaid limits in the runtime', () => {
  beforeEach(() => {
    peleMock.renderAsync.mockReset()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders with the shared options and limits', async () => {
    const { renderMermaid } = await loadModules()
    const root = document.createElement('div')

    peleMock.renderAsync.mockResolvedValue({ svg: SVG })
    await renderMermaid(createPayload('flowchart TD\nA-->B'), createContext(root))

    expect(peleMock.renderAsync).toHaveBeenCalledWith(
      'flowchart TD\nA-->B',
      expect.objectContaining({
        ...DIAGRAM_RENDER_OPTIONS,
        maxEdges: MERMAID_MAX_EDGES,
        limit: MERMAID_MAX_TEXT_SIZE,
      }),
    )
    expect(root.querySelector('.besidka-mermaid > besidka-mermaid')).not.toBeNull()
  })

  it('turns the edge limit into a DiagramLimitError with a neutral placeholder', async () => {
    const { renderMermaid, DiagramLimitError } = await loadModules()
    const root = document.createElement('div')

    peleMock.renderAsync.mockRejectedValue(new Error(EDGE_MESSAGE))

    const rendering = renderMermaid(createPayload('flowchart TD\nA-->B'), createContext(root))

    await expect(rendering).rejects.toBeInstanceOf(DiagramLimitError)
    expect(root.querySelector('[data-testid="besidka-diagram-limit"]')?.textContent)
      .toBe('This diagram is too large to draw.')
    expect(root.querySelector('.besidka-mermaid')).toBeNull()
  })

  it('rejects an oversized source without asking the renderer', async () => {
    const { renderMermaid, DiagramLimitError } = await loadModules()
    const root = document.createElement('div')
    const source = `flowchart TD\n${'A-->B\n'.repeat(MERMAID_MAX_TEXT_SIZE)}`

    const rendering = renderMermaid(createPayload(source), createContext(root))

    await expect(rendering).rejects.toBeInstanceOf(DiagramLimitError)
    expect(peleMock.renderAsync).not.toHaveBeenCalled()
  })

  it('lets a syntax error through unchanged', async () => {
    const { renderMermaid } = await loadModules()
    const root = document.createElement('div')

    peleMock.renderAsync.mockRejectedValue(new Error('Parse error on line 2'))

    await expect(renderMermaid(createPayload('bad'), createContext(root)))
      .rejects.toThrow('Parse error on line 2')
    expect(root.querySelector('[data-testid="besidka-diagram-limit"]')).toBeNull()
  })

  it('reports a limit error once with the raw text in the details and no red panel', async () => {
    const { renderMermaid, report } = await loadModules()
    const notified: unknown[] = []
    const root = document.createElement('div')

    peleMock.renderAsync.mockRejectedValue(new Error(EDGE_MESSAGE))
    report.setHostNotifier((params) => {
      notified.push(params)
    })
    report.resetReportBudget()

    try {
      await renderMermaid(createPayload('flowchart TD\nA-->B'), createContext(root))
    } catch (exception) {
      report.reportError(exception)
    }

    expect(notified).toEqual([{
      level: 'error',
      data: {
        message: 'This diagram is too large to draw: it has more than 500 connections, the limit is 500. Split it into smaller diagrams.',
        stack: EDGE_MESSAGE,
        code: 'mermaid-edge-limit',
        limit: MERMAID_MAX_EDGES,
      },
    }])
    expect(document.getElementById('besidka-runtime-error')).toBeNull()
  })

  it('still shows the red panel for an ordinary error', async () => {
    const { report } = await loadModules()

    report.resetReportBudget()
    report.reportError(new Error('boom'))

    expect(document.getElementById('besidka-runtime-error')?.textContent)
      .toContain('boom')
  })
})
