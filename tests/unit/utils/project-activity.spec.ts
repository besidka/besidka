import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../../../server/db/schema'
import { refreshProjectActivityAt } from '../../../server/utils/projects/activity'

describe('refreshProjectActivityAt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recomputes project activity from the latest remaining chat or project creation time', async () => {
    const projectSetWhere = vi.fn(async () => undefined)
    const projectSet = vi.fn(() => ({
      where: projectSetWhere,
    }))
    const db = {
      query: {
        projects: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({
              id: 'project-1',
              createdAt: new Date('2026-03-01T08:00:00.000Z'),
            })
            .mockResolvedValueOnce({
              id: 'project-2',
              createdAt: new Date('2026-03-02T08:00:00.000Z'),
            }),
        },
        chats: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({
              activityAt: new Date('2026-03-11T08:00:00.000Z'),
            })
            .mockResolvedValueOnce(null),
        },
      },
      update: vi.fn((table: unknown) => {
        expect(table).toBe(schema.projects)

        return {
          set: projectSet,
        }
      }),
    }

    await refreshProjectActivityAt(
      ['project-1', 'project-2', 'project-1', null, undefined],
      1,
      db as any,
    )

    expect(db.query.projects.findFirst).toHaveBeenCalledTimes(2)
    expect(db.query.chats.findFirst).toHaveBeenCalledTimes(2)
    expect(projectSet).toHaveBeenNthCalledWith(1, {
      activityAt: new Date('2026-03-11T08:00:00.000Z'),
    })
    expect(projectSet).toHaveBeenNthCalledWith(2, {
      activityAt: new Date('2026-03-02T08:00:00.000Z'),
    })
    expect(projectSetWhere).toHaveBeenCalledTimes(2)
  })
})
