import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryEntry } from '#shared/types/memory.d'

const mocks = vi.hoisted(() => {
  return {
    createMemoryEntry: vi.fn(),
    updateMemoryEntry: vi.fn(),
    deleteMemoryEntry: vi.fn(),
    listMemoryEntries: vi.fn(),
    resolveMemoryJevChecker: vi.fn(),
    enforceMemoryRateLimit: vi.fn(),
    logger: { set: vi.fn() },
    db: { marker: 'db' } as unknown as ReturnType<typeof useDb>,
  }
})

vi.mock('~~/server/utils/memory/entries', () => {
  return {
    createMemoryEntry: mocks.createMemoryEntry,
    updateMemoryEntry: mocks.updateMemoryEntry,
    deleteMemoryEntry: mocks.deleteMemoryEntry,
    listMemoryEntries: mocks.listMemoryEntries,
  }
})

vi.mock('~~/server/utils/memory/jev-check', () => {
  return { resolveMemoryJevChecker: mocks.resolveMemoryJevChecker }
})

vi.mock('~~/server/utils/memory/rate-limit', () => {
  return { enforceMemoryRateLimit: mocks.enforceMemoryRateLimit }
})

const {
  MCP_MEMORY_COMPLIANCE_ORIGIN,
  addMcpMemory,
  deleteMcpMemory,
  listMcpMemory,
  updateMcpMemory,
} = await import('~~/server/utils/mcp/private/memory')

function memoryEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'mem1',
    projectId: null,
    category: 'preferences',
    slug: 'tea',
    title: 'Tea',
    description: 'Prefers green tea',
    body: 'Prefers green tea without sugar.',
    sensitivity: 'none',
    sensitiveCategory: null,
    origin: 'user',
    sourceChatIds: [],
    sourceMessageId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
  }
}

describe('mcp memory tools', () => {
  beforeEach(() => {
    for (const mock of [
      mocks.createMemoryEntry,
      mocks.updateMemoryEntry,
      mocks.deleteMemoryEntry,
      mocks.listMemoryEntries,
      mocks.resolveMemoryJevChecker,
      mocks.enforceMemoryRateLimit,
    ]) {
      mock.mockReset()
    }

    mocks.resolveMemoryJevChecker.mockResolvedValue(null)
  })

  it('creates through the compliance-gated createMemoryEntry', async () => {
    mocks.createMemoryEntry.mockResolvedValue(memoryEntry())

    const result = await addMcpMemory(mocks.db, 3, {
      category: 'preferences',
      title: 'Tea',
      description: 'Prefers green tea',
      body: 'Prefers green tea without sugar.',
    }, mocks.logger)

    expect(mocks.enforceMemoryRateLimit).toHaveBeenCalledWith('write', 3)
    expect(mocks.createMemoryEntry).toHaveBeenCalledWith(
      { db: mocks.db, userId: 3, logger: mocks.logger, jev: null },
      {
        input: {
          projectId: null,
          category: 'preferences',
          title: 'Tea',
          description: 'Prefers green tea',
          body: 'Prefers green tea without sugar.',
        },
        origin: 'user',
        complianceOrigin: MCP_MEMORY_COMPLIANCE_ORIGIN,
      },
    )
    expect(result).not.toHaveProperty('sensitivity')
    expect(result).toMatchObject({ id: 'mem1', origin: 'user' })
  })

  it('passes the compliance refusal through unchanged', async () => {
    mocks.createMemoryEntry.mockRejectedValue(Object.assign(
      new Error('Sensitive topics are not saved to memory.'),
      { status: 422 },
    ))

    await expect(addMcpMemory(mocks.db, 3, {
      category: 'profile',
      title: 'Health',
      description: 'Health detail',
      body: 'Health detail',
    }, mocks.logger)).rejects.toMatchObject({ status: 422 })
  })

  it('updates only the fields that were sent', async () => {
    mocks.updateMemoryEntry.mockResolvedValue({
      entry: memoryEntry({ title: 'Green tea' }),
      previous: memoryEntry(),
    })

    await updateMcpMemory(mocks.db, 3, {
      id: 'mem1',
      title: 'Green tea',
      body: undefined,
    }, mocks.logger)

    expect(mocks.updateMemoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 3 }),
      {
        id: 'mem1',
        patch: { title: 'Green tea' },
        origin: 'user',
        complianceOrigin: MCP_MEMORY_COMPLIANCE_ORIGIN,
      },
    )
  })

  it('refuses an empty update without writing', async () => {
    await expect(updateMcpMemory(mocks.db, 3, { id: 'mem1' }, mocks.logger))
      .rejects.toMatchObject({ status: 400 })
    expect(mocks.enforceMemoryRateLimit).not.toHaveBeenCalled()
    expect(mocks.updateMemoryEntry).not.toHaveBeenCalled()
  })

  it('answers 404 when deleting an unknown entry', async () => {
    mocks.deleteMemoryEntry.mockResolvedValue(null)

    await expect(deleteMcpMemory(mocks.db, 3, { id: 'nope' })).rejects
      .toMatchObject({ status: 404 })
  })

  it('lists the account or one project', async () => {
    mocks.listMemoryEntries.mockResolvedValue([memoryEntry()])

    await expect(listMcpMemory(mocks.db, 3, {})).resolves.toMatchObject({
      scope: 'account',
      entries: [{ id: 'mem1' }],
    })
    expect(mocks.listMemoryEntries).toHaveBeenLastCalledWith({
      db: mocks.db,
      userId: 3,
      scope: { kind: 'account' },
    })

    await listMcpMemory(mocks.db, 3, { projectId: 'proj1' })

    expect(mocks.listMemoryEntries).toHaveBeenLastCalledWith({
      db: mocks.db,
      userId: 3,
      scope: { kind: 'project', projectId: 'proj1' },
    })
  })
})
