import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectUsesMemoryEntries } from '../../../../server/utils/projects/memory-entries'

function createDb(entry: { id: string } | undefined) {
  return {
    query: {
      memoryEntries: {
        findFirst: vi.fn(async () => entry),
      },
    },
  }
}

describe('projectUsesMemoryEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is true for a migrated project without querying entries', async () => {
    const db = createDb(undefined)

    const result = await projectUsesMemoryEntries(
      { id: 'project-1', memoryMigratedAt: new Date() },
      1,
      db as never,
    )

    expect(result).toBe(true)
    expect(db.query.memoryEntries.findFirst).not.toHaveBeenCalled()
  })

  it('is true when the user has an entry scoped to the project', async () => {
    const db = createDb({ id: 'entry-1' })

    const result = await projectUsesMemoryEntries(
      { id: 'project-1', memoryMigratedAt: null },
      7,
      db as never,
    )

    expect(result).toBe(true)
    expect(db.query.memoryEntries.findFirst).toHaveBeenCalledWith({
      where: { userId: 7, projectId: 'project-1' },
      columns: { id: true },
    })
  })

  it('is false without a migration marker or entries', async () => {
    const db = createDb(undefined)

    const result = await projectUsesMemoryEntries(
      { id: 'project-1' },
      1,
      db as never,
    )

    expect(result).toBe(false)
  })
})
