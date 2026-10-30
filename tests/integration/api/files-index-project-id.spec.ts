import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { createKnowledgeTestDb } from '../../setup/helpers/knowledge-db'
import type { KnowledgeTestDb } from '../../setup/helpers/knowledge-db'

const OWNER = 1
const STRANGER = 2

interface FilesPage {
  files: Array<{ id: string, name: string }>
  total: number
  offset: number
  limit: number
}

describe('files index API projectId filter', () => {
  let testDb: KnowledgeTestDb
  let query: Record<string, string>

  async function listPage(input: Record<string, string>) {
    query = { source: 'project', limit: '100', ...input }

    const module = await import('~~/server/api/v1/files/index.get')

    return await module.default({} as never) as FilesPage
  }

  function link(projectId: number, fileId: number, userId = OWNER) {
    testDb.insertItem({ userId, projectId, kind: 'file', fileId })
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
    testDb.insertFile({ id: 1, userId: OWNER, name: 'a.pdf', createdAt: 100 })
    testDb.insertFile({ id: 2, userId: OWNER, name: 'b.pdf', createdAt: 200 })
    testDb.insertFile({ id: 3, userId: OWNER, name: 'c.pdf', createdAt: 300 })
    testDb.insertFile({ id: 4, userId: OWNER, name: 'd.pdf', createdAt: 400 })
    testDb.insertFile({ id: 5, userId: STRANGER, name: 'x.pdf' })
    link(10, 1)
    link(10, 2)
    link(10, 3)
    link(11, 3)
    link(11, 4)
    link(20, 5, STRANGER)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('lists only the files linked to the project, newest first', async () => {
    const page = await listPage({ projectId: encodePublicId(10) })

    expect(page.files.map(file => file.name)).toEqual([
      'c.pdf',
      'b.pdf',
      'a.pdf',
    ])
    expect(page.total).toBe(3)
  })

  it('pages with offset and limit and keeps the total', async () => {
    const projectId = encodePublicId(10)
    const first = await listPage({ projectId, limit: '2' })
    const second = await listPage({ projectId, limit: '2', offset: '2' })

    expect(first.files.map(file => file.name)).toEqual(['c.pdf', 'b.pdf'])
    expect(second.files.map(file => file.name)).toEqual(['a.pdf'])
    expect(first.total).toBe(3)
    expect(second.total).toBe(3)
    expect(second.offset).toBe(2)
    expect(second.limit).toBe(2)
  })

  it('shows a file linked to two projects under each', async () => {
    const first = await listPage({ projectId: encodePublicId(10) })
    const second = await listPage({ projectId: encodePublicId(11) })

    expect(first.files.map(file => file.name)).toContain('c.pdf')
    expect(second.files.map(file => file.name)).toEqual(['d.pdf', 'c.pdf'])
    expect(second.total).toBe(2)
  })

  it('returns an empty page for a foreign project id', async () => {
    const page = await listPage({ projectId: encodePublicId(20) })

    expect(page.files).toEqual([])
    expect(page.total).toBe(0)
  })

  it('returns an empty page for an unknown project id', async () => {
    const page = await listPage({ projectId: encodePublicId(999) })

    expect(page.files).toEqual([])
    expect(page.total).toBe(0)
  })

  it('returns an empty page for a malformed project id', async () => {
    for (const projectId of ['not-a-public-id!', '%', '0', '-1']) {
      const page = await listPage({ projectId })

      expect(page.files).toEqual([])
      expect(page.total).toBe(0)
    }
  })

  it('does not let a stranger read the owner project', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: String(STRANGER) },
    }))

    const page = await listPage({ projectId: encodePublicId(10) })

    expect(page.files).toEqual([])
    expect(page.total).toBe(0)
  })

  it('combines the project filter with search', async () => {
    const page = await listPage({
      projectId: encodePublicId(10),
      search: 'B.PDF',
    })

    expect(page.files.map(file => file.name)).toEqual(['b.pdf'])
    expect(page.total).toBe(1)
  })

  it('treats percent and underscore in search as literals', async () => {
    testDb.insertFile({ id: 6, userId: OWNER, name: '50%_off.pdf' })
    testDb.insertFile({ id: 7, userId: OWNER, name: '50xxoff.pdf' })
    link(10, 6)
    link(10, 7)

    const projectId = encodePublicId(10)
    const literal = await listPage({ projectId, search: '0%_o' })
    const wildcard = await listPage({ projectId, search: '0x_o' })

    expect(literal.files.map(file => file.name)).toEqual(['50%_off.pdf'])
    expect(wildcard.files).toEqual([])
  })

  it('ignores projectId unless the source is project', async () => {
    const page = await listPage({
      source: 'all',
      projectId: encodePublicId(20),
    })

    expect(page.files.map(file => file.name)).toEqual([])
    expect(page.total).toBe(0)

    testDb.insertFile({ id: 8, userId: OWNER, name: 'loose.pdf' })

    const looseOnly = await listPage({
      source: 'all',
      projectId: encodePublicId(20),
    })

    expect(looseOnly.files.map(file => file.name)).toEqual(['loose.pdf'])
  })

  it('orders files with equal createdAt by id descending', async () => {
    for (const id of [10, 11, 12, 13, 14]) {
      testDb.insertFile({
        id,
        userId: OWNER,
        name: `tie-${id}.pdf`,
        createdAt: 50,
      })
      link(12, id)
    }

    const projectId = encodePublicId(12)
    const first = await listPage({ projectId, limit: '2' })
    const second = await listPage({ projectId, limit: '2', offset: '2' })
    const third = await listPage({ projectId, limit: '2', offset: '4' })
    const names = [...first.files, ...second.files, ...third.files]
      .map(file => file.name)

    expect(names).toEqual([
      'tie-14.pdf',
      'tie-13.pdf',
      'tie-12.pdf',
      'tie-11.pdf',
      'tie-10.pdf',
    ])
  })
})
