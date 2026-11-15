import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillArchiveFile } from '#shared/utils/skills/archive'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  createFakeSkillKv,
  seedSkill,
} from '../../../../../setup/helpers/skills-db'
import { skillMarkdown } from '../../../../../setup/helpers/skill-archives'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const { createSkillImportPreview } = await import(
  '~~/server/utils/skills/import/preview'
)

const encoder = new TextEncoder()

function archiveFile(path: string, text: string): SkillArchiveFile {
  return { path, bytes: encoder.encode(text), text }
}

describe('createSkillImportPreview lookalike checks', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
  })

  afterEach(() => {
    testDb.close()
  })

  async function preview(input: {
    name: string
    url: string | null
  }) {
    return await createSkillImportPreview({
      db: testDb.db,
      kv: createFakeSkillKv(),
      bucket: createFakeSkillBucket(),
      userId,
      source: input.url ? 'github' : 'zip',
      sourceVersion: 'a'.repeat(40),
      provenance: input.url
        ? { url: input.url, ref: 'main', path: null }
        : undefined,
      fileName: null,
      files: [archiveFile('SKILL.md', skillMarkdown({ name: input.name }))],
      folderName: null,
      archiveWarnings: [],
      logger: { set: vi.fn() },
    })
  }

  function rulesOf(result: Awaited<ReturnType<typeof preview>>): string[] {
    return result.findings.map((finding) => {
      return finding.rule
    })
  }

  it('flags a GitHub owner that is close to a well-known owner', async () => {
    const result = await preview({
      name: 'weekly-report',
      url: 'https://github.com/anthropic/skills',
    })

    expect(rulesOf(result)).toContain('owner-lookalike')
    expect(result.findings.find((finding) => {
      return finding.rule === 'owner-lookalike'
    })?.detail).toBe('close to the well-known owner "anthropics"')
  })

  it('says nothing about the real owner, and nothing for a zip', async () => {
    expect(rulesOf(await preview({
      name: 'weekly-report',
      url: 'https://github.com/anthropics/skills',
    }))).not.toContain('owner-lookalike')
    expect(rulesOf(await preview({ name: 'weekly-report', url: null })))
      .not.toContain('owner-lookalike')
  })

  it('compares the skill name with the account other skills', async () => {
    await seedSkill(testDb.db, userId, { name: 'release-notes' })

    expect(rulesOf(await preview({ name: 'release-notez', url: null })))
      .toContain('name-lookalike')
    expect(rulesOf(await preview({ name: 'release-notes', url: null })))
      .not.toContain('name-lookalike')
  })

  it('does not flag a name from anthropics/skills itself', async () => {
    expect(rulesOf(await preview({
      name: 'pdg',
      url: 'https://github.com/anthropics/skills',
    }))).not.toContain('name-lookalike')
    expect(rulesOf(await preview({
      name: 'pdg',
      url: 'https://github.com/someone/skills',
    }))).toContain('name-lookalike')
  })
})
