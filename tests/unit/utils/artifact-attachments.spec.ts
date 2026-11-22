import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_ATTACHMENTS_MAX,
  ARTIFACT_ATTACHMENT_PART_TYPE,
  collectArtifactAttachments,
  isDataArtifactAttachmentPart,
  isDataArtifactPart,
  toArtifactAttachmentPart,
} from '#shared/utils/artifacts'

const data = {
  artifactId: 'art-1',
  version: 2,
  kind: 'html' as const,
  title: 'Quiz',
}

describe('artifact attachment parts', () => {
  it('uses its own part type, apart from data-artifact', () => {
    const part = toArtifactAttachmentPart(data)

    expect(part).toEqual({ type: ARTIFACT_ATTACHMENT_PART_TYPE, data })
    expect(ARTIFACT_ATTACHMENT_PART_TYPE).toBe('data-artifact-attachment')
    expect(isDataArtifactAttachmentPart(part)).toBe(true)
    expect(isDataArtifactPart(part)).toBe(false)
    expect(isDataArtifactAttachmentPart({ type: 'data-artifact', data }))
      .toBe(false)
  })

  it('copies only the four known fields', () => {
    const part = toArtifactAttachmentPart({
      ...data,
      extra: 'x',
    } as typeof data)

    expect(Object.keys(part.data).sort()).toEqual([
      'artifactId',
      'kind',
      'title',
      'version',
    ])
  })

  it('rejects malformed parts', () => {
    expect(isDataArtifactAttachmentPart(null)).toBe(false)
    expect(isDataArtifactAttachmentPart({
      type: ARTIFACT_ATTACHMENT_PART_TYPE,
    })).toBe(false)
    expect(isDataArtifactAttachmentPart({
      type: ARTIFACT_ATTACHMENT_PART_TYPE,
      data: { ...data, kind: 'exe' },
    })).toBe(false)
    expect(isDataArtifactAttachmentPart({
      type: ARTIFACT_ATTACHMENT_PART_TYPE,
      data: { ...data, version: 1.5 },
    })).toBe(false)
  })

  it('allows as many attachments as the context holds', () => {
    expect(ARTIFACT_ATTACHMENTS_MAX).toBe(3)
  })
})

describe('collectArtifactAttachments', () => {
  const attach = (artifactId: string, version = 1) => {
    return toArtifactAttachmentPart({ ...data, artifactId, version })
  }

  it('reads user messages only, newest message first, each artifact once',
    () => {
      const result = collectArtifactAttachments([
        { role: 'user', parts: [attach('a', 1)] },
        { role: 'assistant', parts: [attach('x', 1)] },
        { role: 'user', parts: [attach('b', 1), attach('a', 2)] },
      ])

      expect(result.map(item => item.artifactId)).toEqual(['b', 'a'])
      expect(result.find(item => item.artifactId === 'a')?.version).toBe(2)
    })

  it('ignores messages without parts and other part types', () => {
    expect(collectArtifactAttachments([
      { role: 'user' },
      { role: 'user', parts: 'nope' },
      {
        role: 'user',
        parts: [{ type: 'text', text: 'hi' }, { type: 'data-artifact', data }],
      },
    ])).toEqual([])
  })
})
