import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENT_MEDIA_TYPES } from '#shared/utils/documents'
import { createKnowledgeTestDb } from '../../setup/helpers/knowledge-db'
import type { KnowledgeTestDb } from '../../setup/helpers/knowledge-db'

const OWNER = 1
const STRANGER = 2

describe('files index API kind filter', () => {
  let testDb: KnowledgeTestDb
  let query: Record<string, string>

  async function list(params: Record<string, string>) {
    query = { limit: '100', ...params }

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
    testDb.insertFile({
      id: 1,
      userId: OWNER,
      name: 'chart.png',
      type: 'image/png',
      source: 'assistant',
    })
    testDb.insertFile({
      id: 2,
      userId: OWNER,
      name: 'photo.jpeg',
      type: 'image/jpeg',
      source: 'assistant',
    })
    testDb.insertFile({
      id: 3,
      userId: OWNER,
      name: 'report.pdf',
      type: DOCUMENT_MEDIA_TYPES.pdf,
      source: 'assistant',
    })
    testDb.insertFile({
      id: 4,
      userId: OWNER,
      name: 'letter.docx',
      type: DOCUMENT_MEDIA_TYPES.docx,
      source: 'assistant',
    })
    testDb.insertFile({
      id: 5,
      userId: OWNER,
      name: 'deck.pptx',
      type: DOCUMENT_MEDIA_TYPES.pptx,
      source: 'assistant',
    })
    testDb.insertFile({
      id: 6,
      userId: OWNER,
      name: 'budget.xlsx',
      type: DOCUMENT_MEDIA_TYPES.xlsx,
      source: 'assistant',
    })
    testDb.insertFile({
      id: 7,
      userId: OWNER,
      name: 'notes.txt',
      type: 'text/plain',
      source: 'assistant',
    })
    testDb.insertFile({
      id: 8,
      userId: OWNER,
      name: 'upload.pdf',
      type: DOCUMENT_MEDIA_TYPES.pdf,
      source: 'upload',
    })
    testDb.insertFile({
      id: 9,
      userId: STRANGER,
      name: 'stranger.pdf',
      type: DOCUMENT_MEDIA_TYPES.pdf,
      source: 'assistant',
    })
    testDb.insertFile({
      id: 10,
      userId: STRANGER,
      name: 'stranger.png',
      type: 'image/png',
      source: 'assistant',
    })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('returns every generated file without a kind', async () => {
    const result = await list({ source: 'assistant' })

    expect(result.names).toEqual([
      'budget.xlsx',
      'chart.png',
      'deck.pptx',
      'letter.docx',
      'notes.txt',
      'photo.jpeg',
      'report.pdf',
    ])
    expect(result.total).toBe(7)
  })

  it('returns only images for kind=image', async () => {
    const result = await list({ source: 'assistant', kind: 'image' })

    expect(result.names).toEqual(['chart.png', 'photo.jpeg'])
    expect(result.total).toBe(2)
  })

  it('returns only the four document media types for kind=document', async () => {
    const result = await list({ source: 'assistant', kind: 'document' })

    expect(result.names).toEqual([
      'budget.xlsx',
      'deck.pptx',
      'letter.docx',
      'report.pdf',
    ])
    expect(result.total).toBe(4)
  })

  it('combines the kind with the source filter', async () => {
    const generated = await list({ source: 'assistant', kind: 'document' })
    const uploaded = await list({ source: 'upload', kind: 'document' })

    expect(generated.names).not.toContain('upload.pdf')
    expect(uploaded.names).toEqual(['upload.pdf'])
  })

  it('combines the kind with search', async () => {
    const matching = await list({
      source: 'assistant',
      kind: 'document',
      search: 'report',
    })
    const mismatching = await list({
      source: 'assistant',
      kind: 'image',
      search: 'report',
    })

    expect(matching.names).toEqual(['report.pdf'])
    expect(matching.total).toBe(1)
    expect(mismatching.names).toEqual([])
    expect(mismatching.total).toBe(0)
  })

  it('paginates inside the kind with a stable total', async () => {
    const firstPage = await list({
      source: 'assistant',
      kind: 'document',
      limit: '3',
      offset: '0',
    })
    const secondPage = await list({
      source: 'assistant',
      kind: 'document',
      limit: '3',
      offset: '3',
    })

    expect(firstPage.names).toHaveLength(3)
    expect(secondPage.names).toHaveLength(1)
    expect(firstPage.total).toBe(4)
    expect(secondPage.total).toBe(4)
    expect(
      new Set([...firstPage.names, ...secondPage.names]).size,
    ).toBe(4)
  })

  it('never returns another user file for any kind', async () => {
    for (const kind of ['image', 'document']) {
      const result = await list({ source: 'assistant', kind })

      expect(result.names).not.toContain('stranger.pdf')
      expect(result.names).not.toContain('stranger.png')
    }

    const unfiltered = await list({ source: 'all' })

    expect(unfiltered.names).not.toContain('stranger.pdf')
  })

  it('rejects an unknown kind with a 400', async () => {
    query = { source: 'assistant', kind: 'video' }

    const module = await import('~~/server/api/v1/files/index.get')

    await expect(module.default({} as never)).rejects.toMatchObject({
      status: 400,
    })
  })

  it('rejects the all value, which the client never sends', async () => {
    query = { source: 'assistant', kind: 'all' }

    const module = await import('~~/server/api/v1/files/index.get')

    await expect(module.default({} as never)).rejects.toMatchObject({
      status: 400,
    })
  })
})
