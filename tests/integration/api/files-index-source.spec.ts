import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createKnowledgeTestDb } from '../../setup/helpers/knowledge-db'
import type { KnowledgeTestDb } from '../../setup/helpers/knowledge-db'

const OWNER = 1
const STRANGER = 2

describe('files index API source filters', () => {
  let testDb: KnowledgeTestDb
  let query: Record<string, string>

  async function listNames(source: string, search?: string) {
    query = { source, limit: '100', ...(search ? { search } : {}) }

    const module = await import('~~/server/api/v1/files/index.get')
    const result = await module.default({} as never) as {
      files: Array<{ name: string }>
      total: number
    }

    return {
      names: result.files.map(file => file.name).sort(),
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
    testDb.insertFile({ id: 1, userId: OWNER, name: 'chat-upload.pdf' })
    testDb.insertFile({
      id: 2,
      userId: OWNER,
      name: 'generated.png',
      type: 'image/png',
      source: 'assistant',
    })
    testDb.insertFile({ id: 3, userId: OWNER, name: 'project-upload.pdf' })
    testDb.insertFile({
      id: 4,
      userId: OWNER,
      name: 'project-generated.png',
      type: 'image/png',
      source: 'assistant',
    })
    testDb.insertFile({ id: 5, userId: STRANGER, name: 'stranger.pdf' })
    testDb.insertFile({ id: 6, userId: OWNER, name: 'shared-link.pdf' })
    testDb.insertItem({
      userId: OWNER,
      projectId: 10,
      kind: 'file',
      fileId: 3,
    })
    testDb.insertItem({
      userId: OWNER,
      projectId: 10,
      kind: 'file',
      fileId: 4,
    })
    testDb.insertItem({
      userId: OWNER,
      projectId: 10,
      kind: 'file',
      fileId: 6,
    })
    testDb.insertItem({
      userId: OWNER,
      projectId: 11,
      kind: 'file',
      fileId: 6,
    })
    testDb.insertItem({
      userId: STRANGER,
      projectId: 20,
      kind: 'file',
      fileId: 5,
    })
    testDb.insertItem({
      userId: OWNER,
      projectId: 10,
      kind: 'note',
      fileId: null,
    })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('keeps project-linked files out of all', async () => {
    const result = await listNames('all')

    expect(result.names).toEqual(['chat-upload.pdf', 'generated.png'])
    expect(result.total).toBe(2)
  })

  it('keeps project-linked files out of upload', async () => {
    const result = await listNames('upload')

    expect(result.names).toEqual(['chat-upload.pdf'])
    expect(result.total).toBe(1)
  })

  it('keeps project-linked files out of assistant', async () => {
    const result = await listNames('assistant')

    expect(result.names).toEqual(['generated.png'])
    expect(result.total).toBe(1)
  })

  it('lists only project-linked files for project, once each', async () => {
    const result = await listNames('project')

    expect(result.names).toEqual([
      'project-generated.png',
      'project-upload.pdf',
      'shared-link.pdf',
    ])
    expect(result.total).toBe(3)
  })

  it('lists every uploaded file for library, linked or not', async () => {
    const result = await listNames('library')

    expect(result.names).toEqual([
      'chat-upload.pdf',
      'project-upload.pdf',
      'shared-link.pdf',
    ])
    expect(result.total).toBe(3)
  })

  it('never lists another user file under any source', async () => {
    for (const source of ['all', 'upload', 'assistant', 'project', 'library']) {
      const result = await listNames(source)

      expect(result.names).not.toContain('stranger.pdf')
    }
  })

  it('applies search on top of the project predicate', async () => {
    const projectResult = await listNames('project', 'upload')
    const allResult = await listNames('all', 'upload')

    expect(projectResult.names).toEqual(['project-upload.pdf'])
    expect(projectResult.total).toBe(1)
    expect(allResult.names).toEqual(['chat-upload.pdf'])
    expect(allResult.total).toBe(1)
  })

  it('keeps total independent of the page size', async () => {
    query = { source: 'project', limit: '1', offset: '1' }

    const module = await import('~~/server/api/v1/files/index.get')
    const result = await module.default({} as never) as {
      files: unknown[]
      total: number
    }

    expect(result.files).toHaveLength(1)
    expect(result.total).toBe(3)
  })
})
