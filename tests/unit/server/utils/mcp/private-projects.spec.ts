import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeItem } from '#shared/types/project-knowledge.d'

const mocks = vi.hoisted(() => {
  return {
    decodeKnowledgeEntityId: vi.fn(),
    ingestKnowledgeItems: vi.fn(),
    createKnowledgeNote: vi.fn(),
    enforceKnowledgeWriteRateLimit: vi.fn(),
    projectRow: { id: 'proj1' } as { id: string } | undefined,
    logger: { set: vi.fn() },
  }
})

vi.mock('~~/server/utils/knowledge/access', () => {
  return { decodeKnowledgeEntityId: mocks.decodeKnowledgeEntityId }
})

vi.mock('~~/server/utils/knowledge/ingest', () => {
  return {
    createKnowledgeNote: mocks.createKnowledgeNote,
    hashKnowledgeText: async () => {
      return 'a'.repeat(64)
    },
    ingestKnowledgeItems: mocks.ingestKnowledgeItems,
  }
})

vi.mock('~~/server/utils/knowledge/rate-limit', () => {
  return {
    enforceKnowledgeWriteRateLimit: mocks.enforceKnowledgeWriteRateLimit,
  }
})

vi.mock('~~/server/utils/knowledge/items', () => {
  return { listKnowledgeItems: vi.fn() }
})

vi.mock('~~/server/utils/knowledge/text-store', () => {
  return { getKnowledgeItemText: vi.fn() }
})

const {
  addMcpProjectNote,
  addMcpProjectText,
  resolveMcpOwnedProject,
  resolveMcpTextMediaType,
  sliceMcpKnowledgeText,
  toMcpKnowledgeItemSummary,
} = await import('~~/server/utils/mcp/private/projects')

function createDb() {
  const chain = {
    from: () => chain,
    where: () => chain,
    get: async () => mocks.projectRow,
  }

  return {
    select: () => chain,
  } as unknown as ReturnType<typeof useDb>
}

function knowledgeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: 'item1',
    projectId: 'proj1',
    kind: 'file',
    fileId: null,
    title: 'notes.md',
    description: null,
    relativePath: null,
    folderId: null,
    contentHash: null,
    mediaType: 'text/markdown',
    sizeBytes: null,
    pageCount: null,
    textBytes: 11,
    latinChars: 11,
    cyrillicChars: 0,
    otherChars: 0,
    extractStatus: 'ready',
    extractError: null,
    extractor: 'text',
    sendAsNativePdf: false,
    pinned: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('mcp project knowledge helpers', () => {
  beforeEach(() => {
    mocks.decodeKnowledgeEntityId.mockReset()
    mocks.decodeKnowledgeEntityId.mockReturnValue(5)
    mocks.ingestKnowledgeItems.mockReset()
    mocks.createKnowledgeNote.mockReset()
    mocks.enforceKnowledgeWriteRateLimit.mockReset()
    mocks.projectRow = { id: 'proj1' }
  })

  it('slices knowledge text into pages', () => {
    expect(sliceMcpKnowledgeText('abcdef', 0, 4)).toEqual({
      text: 'abcd',
      offset: 0,
      totalChars: 6,
      nextOffset: 4,
    })
    expect(sliceMcpKnowledgeText('abcdef', 4, 4)).toEqual({
      text: 'ef',
      offset: 4,
      totalChars: 6,
      nextOffset: null,
    })
    expect(sliceMcpKnowledgeText('abc', 99, 4).text).toBe('')
  })

  it('picks markdown only for markdown names', () => {
    expect(resolveMcpTextMediaType('notes.md')).toBe('text/markdown')
    expect(resolveMcpTextMediaType('Plan.MARKDOWN')).toBe('text/markdown')
    expect(resolveMcpTextMediaType('notes.txt')).toBe('text/plain')
    expect(resolveMcpTextMediaType('Meeting notes')).toBe('text/plain')
  })

  it('summarises items with the flagged state', () => {
    expect(toMcpKnowledgeItemSummary(knowledgeItem({
      extractStatus: 'flagged',
    }))).toMatchObject({ id: 'item1', status: 'flagged', flagged: true })
  })

  it('treats a foreign or malformed project as not found', async () => {
    mocks.projectRow = undefined

    await expect(resolveMcpOwnedProject(createDb(), 1, 'proj1')).rejects
      .toMatchObject({ status: 404 })

    mocks.decodeKnowledgeEntityId.mockReturnValue(null)

    await expect(resolveMcpOwnedProject(createDb(), 1, '???')).rejects
      .toMatchObject({ status: 404 })
  })

  it('adds text as a committed text file item', async () => {
    mocks.ingestKnowledgeItems.mockResolvedValue({
      items: [knowledgeItem()],
      skipped: [],
      version: 2,
      packVersion: 2,
    })

    const result = await addMcpProjectText(createDb(), 1, {
      projectId: 'proj1',
      name: 'notes.md',
      text: 'Hello world',
    }, mocks.logger)

    expect(mocks.enforceKnowledgeWriteRateLimit).toHaveBeenCalledWith(1)
    expect(mocks.ingestKnowledgeItems).toHaveBeenCalledWith(
      { userId: 1, projectId: 5, logger: mocks.logger },
      {
        items: [{
          title: 'notes.md',
          mediaType: 'text/markdown',
          extractor: 'text',
          extractStatus: 'ready',
          contentHash: 'a'.repeat(64),
          text: 'Hello world',
        }],
        commit: true,
      },
    )
    expect(result).toMatchObject({ id: 'item1', textBytes: 11 })
  })

  it('reports a duplicate text as a conflict', async () => {
    mocks.ingestKnowledgeItems.mockResolvedValue({
      items: [],
      skipped: [{ index: 0, reason: 'duplicate' }],
      version: 2,
      packVersion: 2,
    })

    await expect(addMcpProjectText(createDb(), 1, {
      projectId: 'proj1',
      name: 'notes.md',
      text: 'Hello world',
    }, mocks.logger)).rejects.toMatchObject({ status: 409 })
  })

  it('refuses text with NUL characters before any write', async () => {
    await expect(addMcpProjectText(createDb(), 1, {
      projectId: 'proj1',
      name: 'notes.md',
      text: 'bad\u0000text',
    }, mocks.logger)).rejects.toMatchObject({ status: 400 })
    expect(mocks.ingestKnowledgeItems).not.toHaveBeenCalled()
  })

  it('adds a note through createKnowledgeNote', async () => {
    mocks.createKnowledgeNote.mockResolvedValue(knowledgeItem({
      kind: 'note',
      extractor: 'note',
    }))

    const result = await addMcpProjectNote(createDb(), 1, {
      projectId: 'proj1',
      title: 'Decisions',
      body: 'We ship on Friday.',
    }, mocks.logger)

    expect(mocks.createKnowledgeNote).toHaveBeenCalledWith(
      { userId: 1, projectId: 5, logger: mocks.logger },
      { title: 'Decisions', body: 'We ship on Friday.' },
    )
    expect(result.kind).toBe('note')
  })
})
