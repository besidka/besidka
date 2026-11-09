// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MERMAID_MAX_EDGES, MERMAID_MAX_TEXT_SIZE } from '@besidka/artifacts-protocol'
import type { ArtifactPayload, Theme } from '@besidka/artifacts-protocol'

const mermaidMock = vi.hoisted(() => {
  return {
    initialize: vi.fn(),
    parse: vi.fn(),
  }
})

vi.mock('mermaid', () => {
  return { default: mermaidMock }
})

const EDGE_MESSAGE = 'Edge limit exceeded. 500 edges found, but the limit is 500.\n\nInitialize mermaid with maxEdges set to a higher number.'

async function loadModules() {
  const { renderMermaid } = await import('~~/workers/artifacts-runtime/src/render/mermaid')
  const { DiagramLimitError } = await import('~~/workers/artifacts-runtime/src/render/diagram-limit')
  const report = await import('~~/workers/artifacts-runtime/src/report')
  const { createMermaidConfig } = await import('~~/workers/artifacts-runtime/src/render/mermaid-config')

  return { renderMermaid, DiagramLimitError, report, createMermaidConfig }
}

function createContext(root: HTMLElement) {
  return { root, theme: 'light' as Theme, isCurrent: () => true }
}

function createPayload(content: string): ArtifactPayload {
  return { kind: 'mermaid', title: 'Diagram', content }
}

describe('mermaid limits in the runtime', () => {
  beforeEach(() => {
    mermaidMock.initialize.mockReset()
    mermaidMock.parse.mockReset()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes mermaid with the shared limits', async () => {
    const { createMermaidConfig } = await loadModules()

    expect(createMermaidConfig('light')).toMatchObject({
      maxEdges: MERMAID_MAX_EDGES,
      maxTextSize: MERMAID_MAX_TEXT_SIZE,
    })
  })

  it('turns the edge limit into a DiagramLimitError with a neutral placeholder', async () => {
    const { renderMermaid, DiagramLimitError } = await loadModules()
    const root = document.createElement('div')

    mermaidMock.parse.mockRejectedValue(new Error(EDGE_MESSAGE))

    const rendering = renderMermaid(createPayload('flowchart TD\nA-->B'), createContext(root))

    await expect(rendering).rejects.toBeInstanceOf(DiagramLimitError)
    expect(root.querySelector('[data-testid="besidka-diagram-limit"]')?.textContent)
      .toBe('This diagram is too large to draw.')
    expect(root.querySelector('.besidka-mermaid')).toBeNull()
  })

  it('rejects an oversized source without asking mermaid to render it', async () => {
    const { renderMermaid, DiagramLimitError } = await loadModules()
    const root = document.createElement('div')
    const source = `flowchart TD\n${'A-->B\n'.repeat(MERMAID_MAX_TEXT_SIZE)}`

    const rendering = renderMermaid(createPayload(source), createContext(root))

    await expect(rendering).rejects.toBeInstanceOf(DiagramLimitError)
    expect(mermaidMock.parse).not.toHaveBeenCalled()
  })

  it('lets a syntax error through unchanged', async () => {
    const { renderMermaid } = await loadModules()
    const root = document.createElement('div')

    mermaidMock.parse.mockRejectedValue(new Error('Parse error on line 2'))

    await expect(renderMermaid(createPayload('bad'), createContext(root)))
      .rejects.toThrow('Parse error on line 2')
    expect(root.querySelector('[data-testid="besidka-diagram-limit"]')).toBeNull()
  })

  it('reports a limit error once with the raw text in the details and no red panel', async () => {
    const { renderMermaid, report } = await loadModules()
    const notified: unknown[] = []
    const root = document.createElement('div')

    mermaidMock.parse.mockRejectedValue(new Error(EDGE_MESSAGE))
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
