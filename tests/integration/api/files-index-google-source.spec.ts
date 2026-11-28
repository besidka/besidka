import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createKnowledgeTestDb } from '../../setup/helpers/knowledge-db'
import type { KnowledgeTestDb } from '../../setup/helpers/knowledge-db'

const OWNER = 1
const STRANGER = 2
const DRIVE_ID = '1DriveDriveDriveDriveDriveDrive01'

describe('files index API google source filter', () => {
  let testDb: KnowledgeTestDb
  let query: Record<string, string>

  async function list(source: string, extra: Record<string, string> = {}) {
    query = { source, limit: '100', ...extra }

    const module = await import('~~/server/api/v1/files/index.get')
    const result = await module.default({} as never) as {
      files: Array<{ name: string, externalSource: string | null }>
      total: number
    }

    return {
      names: result.files.map(file => file.name),
      total: result.total,
    }
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
    testDb.insertFile({
      id: 1,
      userId: OWNER,
      name: 'plain-upload.pdf',
      createdAt: 1_000,
    })
    testDb.insertFile({
      id: 2,
      userId: OWNER,
      name: 'older-copy.md',
      createdAt: 2_000,
      externalSource: 'google',
      externalId: DRIVE_ID,
    })
    testDb.insertFile({
      id: 3,
      userId: OWNER,
      name: 'newer-copy.md',
      createdAt: 3_000,
      externalSource: 'google',
      externalId: DRIVE_ID,
    })
    testDb.insertFile({
      id: 4,
      userId: STRANGER,
      name: 'stranger-copy.md',
      createdAt: 4_000,
      externalSource: 'google',
      externalId: DRIVE_ID,
    })
    testDb.insertFile({
      id: 5,
      userId: OWNER,
      name: 'generated.png',
      type: 'image/png',
      source: 'assistant',
      createdAt: 5_000,
    })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('lists only the signed-in user Google copies, newest first', async () => {
    const result = await list('google')

    expect(result.names).toEqual(['newer-copy.md', 'older-copy.md'])
    expect(result.total).toBe(2)
  })

  it('never lists another user copies', async () => {
    const result = await list('google')

    expect(result.names).not.toContain('stranger-copy.md')
  })

  it('searches the copies by name', async () => {
    const result = await list('google', { search: 'OLDER' })

    expect(result.names).toEqual(['older-copy.md'])
    expect(result.total).toBe(1)
  })

  it('pages the copies and keeps the total', async () => {
    const firstPage = await list('google', { limit: '1', offset: '0' })
    const secondPage = await list('google', { limit: '1', offset: '1' })

    expect(firstPage.names).toEqual(['newer-copy.md'])
    expect(secondPage.names).toEqual(['older-copy.md'])
    expect(secondPage.total).toBe(2)
  })

  it('leaves the copies in the upload and all lists', async () => {
    const upload = await list('upload')
    const all = await list('all')

    expect(upload.names).toEqual([
      'newer-copy.md',
      'older-copy.md',
      'plain-upload.pdf',
    ])
    expect(all.names).toContain('older-copy.md')
  })

  it('reports the external source on each row', async () => {
    query = { source: 'google', limit: '100' }

    const module = await import('~~/server/api/v1/files/index.get')
    const result = await module.default({} as never) as {
      files: Array<{ externalSource: string | null, externalId: string }>
    }

    expect(result.files.every((file) => {
      return file.externalSource === 'google' && file.externalId === DRIVE_ID
    })).toBe(true)
  })
})
