import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { DOCUMENT_MEDIA_TYPES } from '#shared/utils/documents'
import { createKnowledgeTestDb } from '../../setup/helpers/knowledge-db'
import type { KnowledgeTestDb } from '../../setup/helpers/knowledge-db'

const OWNER = 1
const STRANGER = 2

describe('files index API document id', () => {
  let testDb: KnowledgeTestDb

  function insertDocument(input: {
    id: number
    userId: number
    fileId: number | null
    status: 'ready' | 'failed' | 'spec_ready'
    createdVia?: 'chat' | 'mcp'
    aiGenerated?: boolean | null
  }) {
    testDb.sqlite.prepare(
      'insert into documents (id, created_at, updated_at, user_id, format,'
      + ' status, render_attempts, file_id, created_via, ai_generated)'
      + ' values (?, 1, 1, ?, ?, ?, 0, ?, ?, ?)',
    ).run(
      input.id,
      input.userId,
      'pdf',
      input.status,
      input.fileId,
      input.createdVia ?? 'chat',
      input.aiGenerated === undefined || input.aiGenerated === null
        ? null
        : Number(input.aiGenerated),
    )
  }

  async function list() {
    const module = await import('~~/server/api/v1/files/index.get')
    const result = await module.default({} as never) as {
      files: Array<{ name: string, documentId: string | null }>
    }

    return Object.fromEntries(result.files.map((file) => {
      return [file.name, file.documentId]
    }))
  }

  beforeEach(() => {
    vi.resetModules()
    testDb = createKnowledgeTestDb()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: String(OWNER) },
    }))
    vi.stubGlobal('useUnauthorizedError', vi.fn())
    vi.stubGlobal('getQuery', () => ({ limit: '100' }))

    for (const [id, name] of [
      [1, 'ready.pdf'],
      [2, 'detached.pdf'],
      [3, 'uploaded.pdf'],
      [4, 'foreign-document.pdf'],
    ] as const) {
      testDb.insertFile({
        id,
        userId: OWNER,
        name,
        type: DOCUMENT_MEDIA_TYPES.pdf,
        source: id === 3 ? 'upload' : 'assistant',
      })
    }
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('returns the public id of the ready document behind a file', async () => {
    insertDocument({ id: 11, userId: OWNER, fileId: 1, status: 'ready' })

    const documentIds = await list()

    expect(documentIds['ready.pdf']).toBe(encodePublicId(11))
  })

  it('returns null for files without a ready document of the owner',
    async () => {
      insertDocument({ id: 12, userId: OWNER, fileId: null, status: 'failed' })
      insertDocument({ id: 13, userId: OWNER, fileId: 2, status: 'spec_ready' })
      insertDocument({ id: 14, userId: STRANGER, fileId: 4, status: 'ready' })

      const documentIds = await list()

      expect(documentIds['ready.pdf']).toBeNull()
      expect(documentIds['detached.pdf']).toBeNull()
      expect(documentIds['uploaded.pdf']).toBeNull()
      expect(documentIds['foreign-document.pdf']).toBeNull()
    })

  it('does not duplicate a file that two document rows point at',
    async () => {
      insertDocument({ id: 15, userId: OWNER, fileId: 1, status: 'ready' })
      insertDocument({ id: 16, userId: OWNER, fileId: 1, status: 'ready' })

      const module = await import('~~/server/api/v1/files/index.get')
      const result = await module.default({} as never) as {
        files: Array<{ name: string }>
        total: number
      }

      expect(result.files.filter(file => file.name === 'ready.pdf'))
        .toHaveLength(1)
      expect(result.total).toBe(4)
    })

  async function listFlags() {
    const module = await import('~~/server/api/v1/files/index.get')
    const result = await module.default({} as never) as {
      files: Array<{ name: string, documentAiGenerated: boolean | null }>
    }

    return Object.fromEntries(result.files.map((file) => {
      return [file.name, file.documentAiGenerated]
    }))
  }

  it('returns the stored AI flag of a document file', async () => {
    insertDocument({
      id: 21,
      userId: OWNER,
      fileId: 1,
      status: 'ready',
      createdVia: 'mcp',
      aiGenerated: false,
    })
    insertDocument({
      id: 22,
      userId: OWNER,
      fileId: 2,
      status: 'ready',
      createdVia: 'mcp',
      aiGenerated: true,
    })

    const flags = await listFlags()

    expect(flags['ready.pdf']).toBe(false)
    expect(flags['detached.pdf']).toBe(true)
  })

  it('reads a missing flag as AI for chat and as not AI for MCP',
    async () => {
      insertDocument({ id: 23, userId: OWNER, fileId: 1, status: 'ready' })
      insertDocument({
        id: 24,
        userId: OWNER,
        fileId: 2,
        status: 'ready',
        createdVia: 'mcp',
      })

      const flags = await listFlags()

      expect(flags['ready.pdf']).toBe(true)
      expect(flags['detached.pdf']).toBe(false)
    })

  it('returns null for a file without a document', async () => {
    const flags = await listFlags()

    expect(flags['uploaded.pdf']).toBeNull()
  })

  it('does not expose the raw document columns', async () => {
    insertDocument({ id: 25, userId: OWNER, fileId: 1, status: 'ready' })

    const module = await import('~~/server/api/v1/files/index.get')
    const result = await module.default({} as never) as {
      files: Array<Record<string, unknown>>
    }

    expect(result.files[0]).not.toHaveProperty('documentCreatedVia')
    expect(result.files[0]).toHaveProperty('documentAiGenerated')
  })
})
