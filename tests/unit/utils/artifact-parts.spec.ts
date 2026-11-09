import { describe, expect, it } from 'vitest'
import {
  collectArtifactVersions,
  countArtifactLines,
  getArtifactPartModel,
  getRenderedPartKeys,
  isArtifactMessagePart,
  orderArtifactPartsLast,
} from '../../../app/utils/artifact-parts'

const OUTPUT = {
  artifactId: 'art_1',
  version: 2,
  kind: 'html',
  title: 'Landing page',
}

describe('isArtifactMessagePart', () => {
  it('matches persisted and streaming artifact parts only', () => {
    expect(isArtifactMessagePart({ type: 'data-artifact', data: OUTPUT }))
      .toBe(true)
    expect(isArtifactMessagePart({ type: 'tool-create_artifact' })).toBe(true)
    expect(isArtifactMessagePart({ type: 'tool-update_artifact' })).toBe(true)
    expect(isArtifactMessagePart({ type: 'tool-generate_image' })).toBe(false)
    expect(isArtifactMessagePart({ type: 'text', text: 'x' })).toBe(false)
    expect(isArtifactMessagePart(null)).toBe(false)
  })
})

describe('getArtifactPartModel', () => {
  it('reads a persisted data-artifact part as ready', () => {
    expect(getArtifactPartModel({ type: 'data-artifact', data: OUTPUT }))
      .toMatchObject({
        state: 'ready',
        artifactId: 'art_1',
        version: 2,
        kind: 'html',
        title: 'Landing page',
        toolCallId: null,
      })
  })

  it('reads a streaming create call without any input yet', () => {
    expect(getArtifactPartModel({
      type: 'tool-create_artifact',
      toolCallId: 'call_1',
      state: 'input-streaming',
    })).toMatchObject({
      state: 'streaming',
      operation: 'create',
      toolCallId: 'call_1',
      artifactId: null,
      kind: null,
      title: '',
      content: '',
    })
  })

  it('reads partial input while streaming', () => {
    expect(getArtifactPartModel({
      type: 'tool-create_artifact',
      toolCallId: 'call_1',
      state: 'input-streaming',
      input: { kind: 'svg', title: 'Logo', content: '<svg>\n<g/>' },
    })).toMatchObject({
      state: 'streaming',
      kind: 'svg',
      title: 'Logo',
      content: '<svg>\n<g/>',
    })
  })

  it('reads a finished call from its output', () => {
    expect(getArtifactPartModel({
      type: 'tool-update_artifact',
      toolCallId: 'call_2',
      state: 'output-available',
      input: { artifactId: 'art_1', content: 'x' },
      output: OUTPUT,
    })).toMatchObject({
      state: 'ready',
      operation: 'update',
      toolCallId: 'call_2',
      artifactId: 'art_1',
      version: 2,
    })
  })

  it('reads a failed call with its error text', () => {
    expect(getArtifactPartModel({
      type: 'tool-create_artifact',
      toolCallId: 'call_3',
      state: 'output-error',
      input: { kind: 'html', title: 'Broken' },
      errorText: 'Too large',
    })).toMatchObject({
      state: 'failed',
      title: 'Broken',
      errorText: 'Too large',
    })
  })

  it('rejects malformed output and unknown kinds', () => {
    expect(getArtifactPartModel({
      type: 'tool-create_artifact',
      state: 'output-available',
      output: { artifactId: 1 },
    })).toBeNull()
    expect(getArtifactPartModel({
      type: 'data-artifact',
      data: { ...OUTPUT, kind: 'python' },
    })).toBeNull()
    expect(getArtifactPartModel({
      type: 'tool-create_artifact',
      state: 'input-streaming',
      input: { kind: 'python', title: 'x' },
    })).toMatchObject({ kind: null })
  })
})

describe('countArtifactLines', () => {
  it('counts lines of streamed content', () => {
    expect(countArtifactLines('')).toBe(0)
    expect(countArtifactLines('a')).toBe(1)
    expect(countArtifactLines('a\nb\nc')).toBe(3)
  })
})

describe('collectArtifactVersions', () => {
  it('collects distinct referenced versions per artifact', () => {
    const versions = collectArtifactVersions([
      { parts: [{ type: 'data-artifact', data: { ...OUTPUT, version: 3 } }] },
      { parts: [{ type: 'text', text: 'hi' }] },
      {
        parts: [
          { type: 'data-artifact', data: { ...OUTPUT, version: 1 } },
          { type: 'data-artifact', data: { ...OUTPUT, version: 3 } },
          {
            type: 'data-artifact',
            data: { ...OUTPUT, artifactId: '__proto__', version: 1 },
          },
        ],
      },
      { parts: undefined },
    ])

    expect(versions.art_1).toEqual([1, 3])
    expect(Object.hasOwn(versions, '__proto__')).toBe(true)
  })
})

describe('orderArtifactPartsLast', () => {
  const reasoning = { type: 'reasoning', text: 'thinking' }
  const firstText = { type: 'text', text: 'one' }
  const secondText = { type: 'text', text: 'two' }
  const firstArtifact = { type: 'data-artifact', data: OUTPUT }
  const secondArtifact = { type: 'tool-update_artifact' }

  it('moves artifact parts after the text and keeps their order', () => {
    const parts = [
      reasoning,
      firstArtifact,
      firstText,
      secondArtifact,
      secondText,
    ]

    expect(orderArtifactPartsLast(parts)).toEqual([
      reasoning,
      firstText,
      secondText,
      firstArtifact,
      secondArtifact,
    ])
  })

  it('keeps text part positions stable while text streams in', () => {
    const streaming = orderArtifactPartsLast([reasoning, firstArtifact])
    const finished = orderArtifactPartsLast([
      reasoning,
      firstArtifact,
      firstText,
    ])

    expect(streaming).toEqual([reasoning, firstArtifact])
    expect(finished.indexOf(firstText)).toBe(1)
    expect(finished.at(-1)).toBe(firstArtifact)
  })

  it('returns a new array and leaves the stored parts untouched', () => {
    const parts = [firstArtifact, firstText]
    const ordered = orderArtifactPartsLast(parts)

    expect(ordered).not.toBe(parts)
    expect(parts).toEqual([firstArtifact, firstText])
    expect(orderArtifactPartsLast([])).toEqual([])
  })
})

describe('getRenderedPartKeys', () => {
  const reasoning = { type: 'reasoning', text: 'thinking' }
  const text = { type: 'text', text: 'one' }
  const artifact = { type: 'tool-create_artifact' }

  it('keys artifact parts by their stored position, others by rendered position', () => {
    expect(getRenderedPartKeys([reasoning, artifact, text]))
      .toEqual(['part-0', 'part-1', 'artifact-1'])
  })

  it('keeps the artifact key when the first text arrives', () => {
    const beforeText = getRenderedPartKeys([reasoning, artifact])
    const afterText = getRenderedPartKeys([reasoning, artifact, text])

    expect(beforeText).toEqual(['part-0', 'artifact-1'])
    expect(afterText.at(-1)).toBe(beforeText.at(-1))
    expect(new Set(afterText).size).toBe(afterText.length)
  })

  it('gives every artifact its own key', () => {
    expect(getRenderedPartKeys([artifact, text, artifact]))
      .toEqual(['part-0', 'artifact-0', 'artifact-2'])
    expect(getRenderedPartKeys([])).toEqual([])
  })
})
