import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { createKnowledgeTestDb } from '../../setup/helpers/knowledge-db'
import type { KnowledgeTestDb } from '../../setup/helpers/knowledge-db'

const OWNER = 1
const STRANGER = 2

interface ProjectGroup {
  id: string
  name: string
  fileCount: number
  pinned: boolean
  archived: boolean
}

describe('files projects API', () => {
  let testDb: KnowledgeTestDb
  let query: Record<string, string>

  async function listGroups(search?: string) {
    query = search === undefined ? {} : { search }

    const module = await import('~~/server/api/v1/files/projects/index.get')
    const result = await module.default({} as never) as {
      projects: ProjectGroup[]
    }

    return result.projects
  }

  function link(projectId: number, fileId: number | null, userId = OWNER) {
    testDb.insertItem({
      userId,
      projectId,
      kind: fileId === null ? 'note' : 'file',
      fileId,
    })
  }

  function setProjectState(
    projectId: number,
    state: {
      pinnedAt?: number | null
      archivedAt?: number | null
      activityAt?: number
    },
  ) {
    testDb.sqlite.prepare(
      'update projects set pinned_at = ?, archived_at = ?, activity_at = ?'
      + ' where id = ?',
    ).run(
      state.pinnedAt ?? null,
      state.archivedAt ?? null,
      state.activityAt ?? 1000,
      projectId,
    )
  }

  beforeEach(() => {
    vi.resetModules()
    testDb = createKnowledgeTestDb()
    query = {}
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: String(OWNER) },
    }))
    vi.stubGlobal('useUnauthorizedError', vi.fn())
    vi.stubGlobal('getQuery', () => query)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('returns an empty list when nothing is linked', async () => {
    testDb.insertProject({ id: 10, userId: OWNER })
    testDb.insertFile({ id: 1, userId: OWNER })

    expect(await listGroups()).toEqual([])
  })

  it('counts linked files per project with public ids', async () => {
    testDb.insertProject({ id: 10, userId: OWNER, name: 'Alpha' })
    testDb.insertProject({ id: 11, userId: OWNER, name: 'Beta' })
    testDb.insertFile({ id: 1, userId: OWNER })
    testDb.insertFile({ id: 2, userId: OWNER })
    testDb.insertFile({ id: 3, userId: OWNER })
    link(10, 1)
    link(10, 2)
    link(11, 3)
    setProjectState(10, { activityAt: 2000 })
    setProjectState(11, { activityAt: 1000 })

    expect(await listGroups()).toEqual([
      {
        id: encodePublicId(10),
        name: 'Alpha',
        fileCount: 2,
        pinned: false,
        archived: false,
      },
      {
        id: encodePublicId(11),
        name: 'Beta',
        fileCount: 1,
        pinned: false,
        archived: false,
      },
    ])
  })

  it('counts a file linked to two projects in both', async () => {
    testDb.insertProject({ id: 10, userId: OWNER })
    testDb.insertProject({ id: 11, userId: OWNER })
    testDb.insertFile({ id: 1, userId: OWNER })
    link(10, 1)
    link(11, 1)

    const groups = await listGroups()

    expect(groups.map(group => group.fileCount)).toEqual([1, 1])
  })

  it('ignores notes that have no file', async () => {
    testDb.insertProject({ id: 10, userId: OWNER })
    testDb.insertProject({ id: 11, userId: OWNER })
    testDb.insertFile({ id: 1, userId: OWNER })
    link(10, 1)
    link(10, null)
    link(11, null)

    const groups = await listGroups()

    expect(groups).toHaveLength(1)
    expect(groups[0]?.fileCount).toBe(1)
  })

  it('counts only files that match the search and omits empty projects',
    async () => {
      testDb.insertProject({ id: 10, userId: OWNER, name: 'Alpha' })
      testDb.insertProject({ id: 11, userId: OWNER, name: 'Beta' })
      testDb.insertFile({ id: 1, userId: OWNER, name: 'Budget.pdf' })
      testDb.insertFile({ id: 2, userId: OWNER, name: 'notes.pdf' })
      testDb.insertFile({ id: 3, userId: OWNER, name: 'summary.pdf' })
      link(10, 1)
      link(10, 2)
      link(11, 3)

      const groups = await listGroups('  budget ')

      expect(groups).toHaveLength(1)
      expect(groups[0]).toMatchObject({ name: 'Alpha', fileCount: 1 })
    })

  it('treats percent and underscore in search as literals', async () => {
    testDb.insertProject({ id: 10, userId: OWNER, name: 'Alpha' })
    testDb.insertFile({ id: 1, userId: OWNER, name: '100%_done.pdf' })
    testDb.insertFile({ id: 2, userId: OWNER, name: '100xxdone.pdf' })
    link(10, 1)
    link(10, 2)

    const percentGroups = await listGroups('%')
    const underscoreGroups = await listGroups('_')
    const literalGroups = await listGroups('0%_d')

    expect(percentGroups[0]?.fileCount).toBe(1)
    expect(underscoreGroups[0]?.fileCount).toBe(1)
    expect(literalGroups[0]?.fileCount).toBe(1)
    expect(await listGroups('0x_d')).toEqual([])
  })

  it('ignores an empty search', async () => {
    testDb.insertProject({ id: 10, userId: OWNER })
    testDb.insertFile({ id: 1, userId: OWNER })
    link(10, 1)

    expect(await listGroups('   ')).toHaveLength(1)
  })

  it('orders pinned, then active by activity, then archived', async () => {
    const projectIds = [10, 11, 12, 13, 14, 15]

    for (const projectId of projectIds) {
      testDb.insertProject({
        id: projectId,
        userId: OWNER,
        name: `Project ${projectId}`,
      })
      testDb.insertFile({ id: projectId, userId: OWNER })
      link(projectId, projectId)
    }

    setProjectState(10, { activityAt: 500 })
    setProjectState(11, { activityAt: 900 })
    setProjectState(12, { pinnedAt: 100, activityAt: 100 })
    setProjectState(13, { pinnedAt: 200, activityAt: 100 })
    setProjectState(14, { archivedAt: 50, activityAt: 9000 })
    setProjectState(15, { archivedAt: 50, activityAt: 8000, pinnedAt: 300 })

    const groups = await listGroups()

    expect(groups.map(group => group.name)).toEqual([
      'Project 13',
      'Project 12',
      'Project 11',
      'Project 10',
      'Project 15',
      'Project 14',
    ])
    expect(groups.map(group => group.pinned)).toEqual([
      true,
      true,
      false,
      false,
      true,
      false,
    ])
    expect(groups.map(group => group.archived)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ])
  })

  it('never leaks another user projects or files', async () => {
    testDb.insertProject({ id: 10, userId: OWNER, name: 'Mine' })
    testDb.insertProject({ id: 20, userId: STRANGER, name: 'Theirs' })
    testDb.insertFile({ id: 1, userId: OWNER })
    testDb.insertFile({ id: 2, userId: STRANGER })
    link(10, 1)
    link(10, 2)
    link(20, 2, STRANGER)

    const groups = await listGroups()

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ name: 'Mine', fileCount: 1 })
  })

  it('omits links whose file row no longer exists', async () => {
    testDb.insertProject({ id: 10, userId: OWNER })
    link(10, 99)

    expect(await listGroups()).toEqual([])
  })

  it('caps the number of returned projects at 200', async () => {
    testDb.insertFile({ id: 1, userId: OWNER })

    for (let projectId = 1; projectId <= 205; projectId++) {
      testDb.insertProject({ id: projectId, userId: OWNER })
      link(projectId, 1)
    }

    expect(await listGroups()).toHaveLength(200)
  })
})
