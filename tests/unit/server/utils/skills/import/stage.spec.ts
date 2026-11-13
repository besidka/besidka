import { describe, expect, it } from 'vitest'
import { analyseSkillFiles } from '#shared/utils/skills/analyse'
import {
  SKILL_STAGE_ID_PATTERN,
  deleteSkillStage,
  readSkillStage,
  readStagedFile,
  skillStageFileKey,
  skillStageKey,
  stageSkillImport,
} from '~~/server/utils/skills/import/stage'
import { SKILLS_STAGING_PREFIX } from '~~/server/utils/skills/storage'
import {
  createFakeSkillBucket,
  createFakeSkillKv,
} from '../../../../../setup/helpers/skills-db'
import { skillMarkdown } from '../../../../../setup/helpers/skill-archives'

const encoder = new TextEncoder()
const NOW = 1_800_000_000_000
const HOUR_MS = 60 * 60 * 1000

function file(path: string, text: string) {
  return { path, bytes: encoder.encode(text), text }
}

async function stageSample(
  overrides: { userId?: number, files?: ReturnType<typeof file>[] } = {},
) {
  const kv = createFakeSkillKv()
  const bucket = createFakeSkillBucket()
  const files = overrides.files ?? [
    file('SKILL.md', skillMarkdown()),
    file('references/a.md', 'same'),
    file('references/b.md', 'same'),
  ]
  const analysis = await analyseSkillFiles({ files, folderName: null })

  if (!analysis.ok) {
    throw new Error('Expected a valid sample')
  }

  const manifest = await stageSkillImport({
    kv,
    bucket,
    userId: overrides.userId ?? 7,
    source: 'zip',
    sourceVersion: 'sha256-0123456789abcdef',
    fileName: 'review.zip',
    analysis,
    files,
    now: NOW,
  })

  return { kv, bucket, manifest }
}

describe('stageSkillImport', () => {
  it('stores the manifest in KV for one hour and files in R2 by content hash', async () => {
    const { kv, bucket, manifest } = await stageSample()

    expect(manifest.stageId).toMatch(SKILL_STAGE_ID_PATTERN)
    expect(kv.put).toHaveBeenCalledWith(
      skillStageKey(manifest.stageId),
      expect.any(String),
      { expirationTtl: 3600 },
    )
    expect(manifest.expiresAt - manifest.createdAt).toBe(HOUR_MS)

    const keys = [...bucket.objects.keys()]

    expect(keys.every((key) => {
      return key.startsWith(`${SKILLS_STAGING_PREFIX}/u7/${manifest.stageId}/`)
    })).toBe(true)
    expect(keys).toHaveLength(2)
    expect(keys.join(' ')).not.toContain('references')
  })

  it('keeps no file content in the KV manifest', async () => {
    const { kv, manifest } = await stageSample()
    const raw = kv.values.get(skillStageKey(manifest.stageId))!

    expect(raw).not.toContain('Read the diff')
    expect(JSON.parse(raw)).toMatchObject({
      userId: 7,
      source: 'zip',
      licence: { class: 'none' },
    })
  })

  it('refuses to stage a restricted skill', async () => {
    const files = [file('SKILL.md', skillMarkdown())]
    const analysis = await analyseSkillFiles({ files, folderName: null })

    if (!analysis.ok) {
      throw new Error('Expected a valid sample')
    }

    await expect(stageSkillImport({
      kv: createFakeSkillKv(),
      bucket: createFakeSkillBucket(),
      userId: 1,
      source: 'text',
      sourceVersion: 'sha256-0123456789abcdef',
      fileName: null,
      analysis: {
        ...analysis,
        licence: { ...analysis.licence, class: 'restricted' },
      },
      files,
    })).rejects.toMatchObject({ status: 500 })
  })
})

describe('readSkillStage', () => {
  it('reads a fresh stage for its owner', async () => {
    const { kv, manifest } = await stageSample()

    await expect(readSkillStage({
      kv,
      userId: 7,
      stageId: manifest.stageId,
      now: NOW + 1000,
    })).resolves.toMatchObject({ stageId: manifest.stageId })
  })

  it('answers null after the hour has passed', async () => {
    const { kv, manifest } = await stageSample()

    await expect(readSkillStage({
      kv,
      userId: 7,
      stageId: manifest.stageId,
      now: NOW + HOUR_MS - 1,
    })).resolves.not.toBeNull()
    await expect(readSkillStage({
      kv,
      userId: 7,
      stageId: manifest.stageId,
      now: NOW + HOUR_MS,
    })).resolves.toBeNull()
  })

  it('answers null for another user, a missing id and a malformed id', async () => {
    const { kv, manifest } = await stageSample()

    await expect(readSkillStage({
      kv,
      userId: 8,
      stageId: manifest.stageId,
      now: NOW,
    })).resolves.toBeNull()
    await expect(readSkillStage({
      kv,
      userId: 7,
      stageId: 'a'.repeat(32),
      now: NOW,
    })).resolves.toBeNull()
    await expect(readSkillStage({
      kv,
      userId: 7,
      stageId: '../../etc',
      now: NOW,
    })).resolves.toBeNull()
  })
})

describe('staged files and deletion', () => {
  it('reads a staged file back by hash and returns null when it is gone', async () => {
    const { bucket, manifest } = await stageSample()
    const [first] = manifest.files
    const bytes = await readStagedFile({
      bucket,
      manifest,
      sha256: first!.sha256,
    })

    expect(bytes).not.toBeNull()
    await expect(readStagedFile({
      bucket,
      manifest,
      sha256: 'f'.repeat(64),
    })).resolves.toBeNull()
  })

  it('deletes the manifest and every staged object in one batch', async () => {
    const { kv, bucket, manifest } = await stageSample()

    await deleteSkillStage({ kv, bucket, manifest })

    expect(kv.values.has(skillStageKey(manifest.stageId))).toBe(false)
    expect(bucket.objects.size).toBe(0)
    expect(bucket.deleteCalls).toHaveLength(1)
    expect(bucket.deleteCalls[0]).toContain(skillStageFileKey(
      7,
      manifest.stageId,
      manifest.files[0]!.sha256,
    ))
  })
})
