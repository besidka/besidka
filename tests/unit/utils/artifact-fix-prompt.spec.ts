import { describe, expect, it } from 'vitest'
import { buildArtifactFixPrompt } from '../../../app/utils/artifact-fix-prompt'

describe('buildArtifactFixPrompt', () => {
  it('quotes the message for an ordinary runtime error', () => {
    expect(buildArtifactFixPrompt('Chart', {
      level: 'error',
      message: 'ReferenceError: x is not defined',
    })).toBe('Fix the error in "Chart": ReferenceError: x is not defined')
  })

  it('asks to split or simplify a diagram over the edge limit', () => {
    const prompt = buildArtifactFixPrompt('Perf mermaid', {
      level: 'error',
      message: 'This diagram is too large to draw.',
      code: 'mermaid-edge-limit',
      limit: 500,
    })

    expect(prompt).toContain('"Perf mermaid"')
    expect(prompt).toContain('more than 500 connections')
    expect(prompt).toMatch(/Split the diagram into several smaller/)
    expect(prompt).toMatch(/do not change any Mermaid configuration/)
    expect(prompt).not.toContain('Fix the error')
  })

  it('includes both sizes for a diagram over the text limit', () => {
    const prompt = buildArtifactFixPrompt('Big', {
      level: 'error',
      message: 'This diagram is too large to draw.',
      code: 'mermaid-text-limit',
      limit: 50_000,
      found: 62_345,
    })

    expect(prompt).toContain('62,345 characters')
    expect(prompt).toContain('50,000 characters')
  })
})
