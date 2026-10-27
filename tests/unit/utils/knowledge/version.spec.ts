import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpKnowledgeVersion } from '~~/server/utils/knowledge/version'
import { createKnowledgeTestDb } from '../../../setup/helpers/knowledge-db'

const OWNER = 1

describe('bumpKnowledgeVersion', () => {
  let testDb: ReturnType<typeof createKnowledgeTestDb>

  beforeEach(() => {
    testDb = createKnowledgeTestDb()
    vi.stubGlobal('useDb', () => testDb.db)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('treats a null version as zero', async () => {
    testDb.insertProject({ id: 1, userId: OWNER, knowledgeVersion: null })

    await bumpKnowledgeVersion([1])

    expect(testDb.getProjectRow(1)?.knowledge_version).toBe(1)
  })

  it('increments an existing version by one', async () => {
    testDb.insertProject({ id: 1, userId: OWNER, knowledgeVersion: 6 })

    await bumpKnowledgeVersion([1])

    expect(testDb.getProjectRow(1)?.knowledge_version).toBe(7)
  })

  it('bumps only the listed projects', async () => {
    testDb.insertProject({ id: 1, userId: OWNER, knowledgeVersion: 1 })
    testDb.insertProject({ id: 2, userId: OWNER, knowledgeVersion: 1 })
    testDb.insertProject({ id: 3, userId: OWNER, knowledgeVersion: 1 })

    await bumpKnowledgeVersion([1, 3])

    expect(testDb.getProjectRow(1)?.knowledge_version).toBe(2)
    expect(testDb.getProjectRow(2)?.knowledge_version).toBe(1)
    expect(testDb.getProjectRow(3)?.knowledge_version).toBe(2)
  })

  it('bumps a project once even when its id is repeated', async () => {
    testDb.insertProject({ id: 1, userId: OWNER, knowledgeVersion: 1 })

    await bumpKnowledgeVersion([1, 1, 1])

    expect(testDb.getProjectRow(1)?.knowledge_version).toBe(2)
  })

  it('does nothing for an empty list', async () => {
    const useDb = vi.fn(() => testDb.db)

    vi.stubGlobal('useDb', useDb)

    await bumpKnowledgeVersion([])

    expect(useDb).not.toHaveBeenCalled()
  })

  it('ignores ids that are not positive integers', async () => {
    testDb.insertProject({ id: 1, userId: OWNER, knowledgeVersion: 1 })

    await bumpKnowledgeVersion([0, -1, 1.5, Number.NaN])

    expect(testDb.getProjectRow(1)?.knowledge_version).toBe(1)
  })

  it('keeps every statement under the bound-parameter limit', async () => {
    const projectCount = 250
    const executedStatements: number[] = []

    for (let id = 1; id <= projectCount; id++) {
      testDb.insertProject({ id, userId: OWNER, knowledgeVersion: 1 })
    }

    const originalPrepare = testDb.sqlite.prepare.bind(testDb.sqlite)

    vi.spyOn(testDb.sqlite, 'prepare').mockImplementation(((source: string) => {
      const statement = originalPrepare(source)

      if (/^update "projects"/i.test(source)) {
        const placeholders = source.match(/\?/g)?.length ?? 0

        executedStatements.push(placeholders)
      }

      return statement
    }) as typeof testDb.sqlite.prepare)

    await bumpKnowledgeVersion(
      Array.from({ length: projectCount }, (_value, index) => {
        return index + 1
      }),
    )

    expect(executedStatements.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...executedStatements)).toBeLessThanOrEqual(92)
    expect(testDb.getProjectRow(1)?.knowledge_version).toBe(2)
    expect(testDb.getProjectRow(projectCount)?.knowledge_version).toBe(2)
  })
})
