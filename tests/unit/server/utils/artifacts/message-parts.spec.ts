import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  collectReferencedArtifactIds,
  isArtifactToolName,
  rewriteArtifactToolParts,
} from '~~/server/utils/artifacts/message-parts'

type Parts = UIMessage['parts']

const output = {
  artifactId: 'abc123',
  version: 2,
  kind: 'html',
  title: 'Quiz',
}

function toolPart(state: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'tool-update_artifact',
    toolCallId: 'call-1',
    state,
    input: {
      artifactId: 'abc123',
      kind: 'html',
      title: 'Quiz',
      content: '<p>secret content</p>',
      edits: [{ old_string: 'a', new_string: 'b' }],
    },
    ...extra,
  }
}

describe('rewriteArtifactToolParts', () => {
  it('turns a finished call into a data-artifact reference', () => {
    const parts = rewriteArtifactToolParts([
      { type: 'text', text: 'Here it is.' },
      toolPart('output-available', { output }),
    ] as Parts)

    expect(parts).toEqual([
      { type: 'text', text: 'Here it is.' },
      { type: 'data-artifact', data: output },
    ])
    expect(JSON.stringify(parts)).not.toContain('secret content')
  })

  it('keeps a failed call with kind, title and error text only', () => {
    const parts = rewriteArtifactToolParts([
      toolPart('output-error', { errorText: 'Edit 1 failed' }),
    ] as Parts)

    expect(parts).toEqual([{
      type: 'tool-update_artifact',
      toolCallId: 'call-1',
      state: 'output-error',
      input: { kind: 'html', title: 'Quiz' },
      errorText: 'Edit 1 failed',
    }])
  })

  it('drops unfinished calls and malformed outputs', () => {
    expect(rewriteArtifactToolParts([
      toolPart('input-streaming'),
      toolPart('input-available'),
      toolPart('output-available', { output: { artifactId: 'x' } }),
      {
        type: 'tool-create_artifact',
        toolCallId: 'call-2',
        state: 'output-available',
        input: { kind: 'html', title: 'T', content: 'c' },
        output: { ...output, kind: 'exe' },
      },
    ] as Parts)).toEqual([])
  })

  it('leaves other tool parts untouched', () => {
    const imagePart = {
      type: 'tool-generate_image',
      toolCallId: 'image',
      state: 'output-available',
      input: { prompt: 'cat' },
      output: { status: 'ready' },
    }

    expect(rewriteArtifactToolParts([imagePart] as Parts)).toEqual([imagePart])
  })
})

describe('collectReferencedArtifactIds', () => {
  it('lists ids from data-artifact parts, newest reference first, once each', () => {
    expect(collectReferencedArtifactIds([
      {
        parts: [
          { type: 'data-artifact', data: { ...output, artifactId: 'first' } },
          { type: 'data-artifact', data: { ...output, artifactId: 'second' } },
        ],
      },
      { parts: [{ type: 'text', text: 'hi' }] },
      {
        parts: [
          { type: 'data-artifact', data: { ...output, artifactId: 'first' } },
          { type: 'data-artifact', data: { artifactId: 'broken' } },
        ],
      },
      { parts: 'not an array' },
    ])).toEqual(['first', 'second'])
  })
})

describe('isArtifactToolName', () => {
  it('knows the two artifact tools', () => {
    expect(isArtifactToolName('create_artifact')).toBe(true)
    expect(isArtifactToolName('update_artifact')).toBe(true)
    expect(isArtifactToolName('generate_image')).toBe(false)
  })
})
