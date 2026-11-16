import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillArchiveFile } from '#shared/utils/skills/archive'
import { createJevDecisionModel } from '~~/server/utils/jev/client'
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
} from '../../../../../setup/helpers/skills-db'
import { skillMarkdown } from '../../../../../setup/helpers/skill-archives'

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  resolveModel: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    experimental_decide: (...args: unknown[]) => mocks.decide(...args),
  }
})

vi.mock('~~/server/utils/jev/roles', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/jev/roles')
  >()

  return {
    ...actual,
    resolveJevRoleModel: (...args: unknown[]) => mocks.resolveModel(...args),
  }
})

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

describe('createSkillImportPreview and the TypeSafe AI check', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    mocks.decide.mockReset()
    mocks.resolveModel.mockReset()
  })

  afterEach(() => {
    testDb.close()
  })

  function preview() {
    return createSkillImportPreview({
      db: testDb.db,
      kv: createFakeSkillKv(),
      bucket: createFakeSkillBucket(),
      userId,
      source: 'zip',
      sourceVersion: 'a'.repeat(40),
      fileName: null,
      files: [archiveFile('SKILL.md', skillMarkdown())],
      folderName: null,
      archiveWarnings: [],
      logger: { set: vi.fn() },
    })
  }

  it('says jev is available when the role resolves a model', async () => {
    mocks.resolveModel.mockResolvedValue(createJevDecisionModel('ts-key'))

    const result = await preview()

    expect(result.jev).toBe('available')
    expect(mocks.resolveModel).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      role: 'injectionScreening',
    }))
  })

  it('leaves jev out without a key or with the role off', async () => {
    mocks.resolveModel.mockResolvedValue(null)

    const result = await preview()

    expect('jev' in result).toBe(false)
  })

  it('never sends anything to TypeSafe AI itself', async () => {
    mocks.resolveModel.mockResolvedValue(createJevDecisionModel('ts-key'))

    await preview()

    expect(mocks.decide).not.toHaveBeenCalled()
  })
})
