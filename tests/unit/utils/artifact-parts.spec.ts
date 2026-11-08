import { describe, expect, it } from 'vitest'
import {
  collectArtifactVersions,
  countArtifactLines,
  getArtifactPartModel,
  isArtifactMessagePart,
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
