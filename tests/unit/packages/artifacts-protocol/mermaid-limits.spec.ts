import { describe, expect, it } from 'vitest'
import {
  MERMAID_MAX_EDGES,
  MERMAID_MAX_TEXT_SIZE,
  buildDiagramLimitFixPrompt,
  describeDiagramLimit,
  detectMermaidLimit,
  isDiagramLimitCode,
  isLogMessageParams,
} from '@besidka/artifacts-protocol'

const MERMAID_EDGE_MESSAGE = [
  'Edge limit exceeded. 500 edges found, but the limit is 500.',
  '',
  'Initialize mermaid with maxEdges set to a higher number to allow more edges.',
  'You cannot set this config via configuration inside the diagram as it is a secure config.',
  'You have to call mermaid.initialize.',
].join('\n')

describe('detectMermaidLimit', () => {
  it('maps the edge limit message to the shared edge limit', () => {
    expect(detectMermaidLimit(MERMAID_EDGE_MESSAGE, 'flowchart TD\nA-->B'))
      .toEqual({ code: 'mermaid-edge-limit', limit: MERMAID_MAX_EDGES })
  })

  it('measures an oversized source before Mermaid replaces it with a stub', () => {
    const source = 'A'.repeat(MERMAID_MAX_TEXT_SIZE + 1)

    expect(detectMermaidLimit('', source)).toEqual({
      code: 'mermaid-text-limit',
      limit: MERMAID_MAX_TEXT_SIZE,
      found: MERMAID_MAX_TEXT_SIZE + 1,
    })
  })

  it('accepts a source exactly at the text limit', () => {
    const source = 'A'.repeat(MERMAID_MAX_TEXT_SIZE)

    expect(detectMermaidLimit('', source)).toBeNull()
  })

  it('leaves syntax errors alone', () => {
    expect(detectMermaidLimit('Parse error on line 2', 'flowchart TD'))
      .toBeNull()
  })
})

describe('describeDiagramLimit', () => {
  it('describes the edge limit without developer wording', () => {
    const message = describeDiagramLimit({
      code: 'mermaid-edge-limit',
      limit: MERMAID_MAX_EDGES,
    })

    expect(message).toBe(
      'This diagram is too large to draw: it has more than 500 connections, the limit is 500. Split it into smaller diagrams.',
    )
    expect(message).not.toMatch(/initialize|maxEdges|config/i)
  })

  it('describes the text limit with both sizes', () => {
    expect(describeDiagramLimit({
      code: 'mermaid-text-limit',
      limit: 50_000,
      found: 62_345,
    })).toBe(
      'This diagram is too large to draw: its source is 62,345 characters, the limit is 50,000 characters. Split it into smaller diagrams.',
    )
  })
})

describe('buildDiagramLimitFixPrompt', () => {
  it('asks to split or simplify the diagram with the limit, not to change config', () => {
    const prompt = buildDiagramLimitFixPrompt('Perf mermaid', {
      code: 'mermaid-edge-limit',
      limit: MERMAID_MAX_EDGES,
    })

    expect(prompt).toContain('"Perf mermaid"')
    expect(prompt).toContain('more than 500 connections')
    expect(prompt).toContain('limit is 500')
    expect(prompt).toMatch(/Split the diagram into several smaller/)
    expect(prompt).toMatch(/do not change any Mermaid configuration/)
  })

  it('includes the measured size for the text limit', () => {
    const prompt = buildDiagramLimitFixPrompt('Big', {
      code: 'mermaid-text-limit',
      limit: 50_000,
      found: 62_345,
    })

    expect(prompt).toContain('62,345 characters')
    expect(prompt).toContain('50,000 characters')
  })
})

describe('diagram limit codes in log messages', () => {
  it('recognises only the known codes', () => {
    expect(isDiagramLimitCode('mermaid-edge-limit')).toBe(true)
    expect(isDiagramLimitCode('mermaid-text-limit')).toBe(true)
    expect(isDiagramLimitCode('other')).toBe(false)
    expect(isDiagramLimitCode(undefined)).toBe(false)
  })

  it('accepts a limit report and rejects a malformed one', () => {
    const valid = {
      level: 'error',
      data: {
        message: 'too large',
        stack: 'raw',
        code: 'mermaid-edge-limit',
        limit: 500,
      },
    }

    expect(isLogMessageParams(valid)).toBe(true)
    expect(isLogMessageParams({
      ...valid,
      data: { ...valid.data, code: 'nope' },
    })).toBe(false)
    expect(isLogMessageParams({
      ...valid,
      data: { ...valid.data, limit: -1 },
    })).toBe(false)
    expect(isLogMessageParams({
      ...valid,
      data: { ...valid.data, found: '5' },
    })).toBe(false)
  })
})
