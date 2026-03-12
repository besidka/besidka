import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../../../server/db/schema'
import { refreshFolderActivityAt } from '../../../server/utils/folders/activity'

describe('refreshFolderActivityAt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recomputes folder activity from the latest remaining chat or folder creation time', async () => {
    const folderSetWhere = vi.fn(async () => undefined)
    const folderSet = vi.fn(() => ({
      where: folderSetWhere,
    }))
    const db = {
      query: {
        folders: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({
              id: 'folder-1',
              createdAt: new Date('2026-03-01T08:00:00.000Z'),
            })
            .mockResolvedValueOnce({
              id: 'folder-2',
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
        expect(table).toBe(schema.folders)

        return {
          set: folderSet,
        }
      }),
    }

    await refreshFolderActivityAt(
      ['folder-1', 'folder-2', 'folder-1', null, undefined],
      1,
      db as any,
    )

    expect(db.query.folders.findFirst).toHaveBeenCalledTimes(2)
    expect(db.query.chats.findFirst).toHaveBeenCalledTimes(2)
    expect(folderSet).toHaveBeenNthCalledWith(1, {
      activityAt: new Date('2026-03-11T08:00:00.000Z'),
    })
    expect(folderSet).toHaveBeenNthCalledWith(2, {
      activityAt: new Date('2026-03-02T08:00:00.000Z'),
    })
    expect(folderSetWhere).toHaveBeenCalledTimes(2)
  })
})
