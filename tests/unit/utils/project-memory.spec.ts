import { beforeEach, describe, expect, it, vi } from 'vitest'
import googleProvider from '../../../providers/google'
import openaiProvider from '../../../providers/openai'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}))

vi.mock('ai', () => ({
  generateText: mocks.generateText,
}))

const googleProjectMemoryModel = googleProvider.models.find((model) => {
  return model.forProjectMemory
})

const openAIProjectMemoryModel = openaiProvider.models.find((model) => {
  return model.forProjectMemory
})

if (!googleProjectMemoryModel || !openAIProjectMemoryModel) {
  throw new Error('Project memory models must be configured in providers')
}

describe('project memory utils', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.generateText.mockReset()
  })

  it('prefers the first provider with a saved key and memory model', async () => {
    const { resolveProjectMemoryModel } = await import(
      '../../../server/utils/projects/memory'
    )
    const db = {
      query: {
        keys: {
          findMany: vi.fn(async () => [
            { provider: 'google' },
            { provider: 'openai' },
          ]),
        },
      },
    }

    const selection = await resolveProjectMemoryModel(1, db as never)

    expect(selection).toEqual({
      providerId: 'google',
      modelId: googleProjectMemoryModel.id,
      modelName: googleProjectMemoryModel.name,
    })
  })

  it('falls back to openai when the google key is not available', async () => {
    const { resolveProjectMemoryModel } = await import(
      '../../../server/utils/projects/memory'
    )
    const db = {
      query: {
        keys: {
          findMany: vi.fn(async () => [{ provider: 'openai' }]),
        },
      },
    }

    const selection = await resolveProjectMemoryModel(1, db as never)

    expect(selection).toEqual({
      providerId: 'openai',
      modelId: openAIProjectMemoryModel.id,
      modelName: openAIProjectMemoryModel.name,
    })
  })

  it('refreshes project memory from current project chats', async () => {
    vi.stubGlobal('useGoogle', vi.fn(async () => ({
      instance: { id: 'google-memory-model' },
    })))

    mocks.generateText
      .mockResolvedValueOnce({
        text: 'User prefers milestone-based roadmap updates.',
      })
      .mockResolvedValueOnce({
        text: 'Keep roadmap updates milestone-based and concise.',
      })

    const { refreshProjectMemory } = await import(
      '../../../server/utils/projects/memory'
    )
    const updateCalls: unknown[] = []
    const db = {
      query: {
        keys: {
          findMany: vi.fn(async () => [{ provider: 'google' }]),
        },
        projects: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({
              id: 'project-1',
              userId: 1,
              name: 'Roadmap',
              memory: null,
              memoryStatus: 'stale',
              memoryUpdatedAt: null,
              memoryDirtyAt: new Date('2026-03-13T10:00:00.000Z'),
              memoryProvider: null,
              memoryModel: null,
              memoryError: null,
            })
            .mockResolvedValueOnce({
              id: 'project-1',
              memory: 'Keep roadmap updates milestone-based and concise.',
              memoryStatus: 'ready',
              memoryUpdatedAt: new Date('2026-03-13T10:05:00.000Z'),
              memoryDirtyAt: null,
              memoryProvider: 'google',
              memoryModel: googleProjectMemoryModel.id,
              memoryError: null,
            }),
        },
        chats: {
          findMany: vi.fn(async () => [{
            id: 'chat-1',
            projectId: 'project-1',
            projectMemorySummary: null,
            projectMemorySummaryUpdatedAt: null,
            messages: [
              {
                createdAt: new Date('2026-03-13T10:01:00.000Z'),
                role: 'user',
                parts: [
                  {
                    type: 'text',
                    text: 'Please keep roadmap summaries grouped by milestone.',
                  },
                ],
              },
              {
                createdAt: new Date('2026-03-13T10:04:00.000Z'),
                role: 'assistant',
                parts: [
                  {
                    type: 'text',
                    text: 'I will keep roadmap updates milestone-based and concise.',
                  },
                ],
              },
            ],
          }]),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(values => ({
          where: vi.fn(async () => {
            updateCalls.push(values)
          }),
        })),
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const result = await refreshProjectMemory('project-1', 1, db as never)

    expect(result).toMatchObject({
      memoryStatus: 'ready',
      memory: 'Keep roadmap updates milestone-based and concise.',
      memoryProvider: 'google',
      memoryModel: googleProjectMemoryModel.id,
    })
    expect(updateCalls).toContainEqual(expect.objectContaining({
      projectMemorySummary: 'User prefers milestone-based roadmap updates.',
      projectMemorySummaryUpdatedAt: expect.any(Date),
    }))
    expect(updateCalls).toContainEqual(expect.objectContaining({
      memoryStatus: 'ready',
      memory: 'Keep roadmap updates milestone-based and concise.',
      memoryProvider: 'google',
      memoryModel: googleProjectMemoryModel.id,
      memoryUpdatedAt: expect.any(Date),
    }))
  })

  it('reuses chat summaries that are already up to date', async () => {
    vi.stubGlobal('useGoogle', vi.fn(async () => ({
      instance: { id: 'google-memory-model' },
    })))

    mocks.generateText.mockResolvedValueOnce({
      text: 'Keep roadmap updates milestone-based and concise.',
    })

    const { refreshProjectMemory } = await import(
      '../../../server/utils/projects/memory'
    )
    const updateCalls: unknown[] = []
    const db = {
      query: {
        keys: {
          findMany: vi.fn(async () => [{ provider: 'google' }]),
        },
        projects: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({
              id: 'project-1',
              userId: 1,
              name: 'Roadmap',
              memory: null,
              memoryStatus: 'stale',
              memoryUpdatedAt: null,
              memoryDirtyAt: new Date('2026-03-13T10:00:00.000Z'),
              memoryProvider: null,
              memoryModel: null,
              memoryError: null,
            })
            .mockResolvedValueOnce({
              id: 'project-1',
              memory: 'Keep roadmap updates milestone-based and concise.',
              memoryStatus: 'ready',
              memoryUpdatedAt: new Date('2026-03-13T10:05:00.000Z'),
              memoryDirtyAt: null,
              memoryProvider: 'google',
              memoryModel: googleProjectMemoryModel.id,
              memoryError: null,
            }),
        },
        chats: {
          findMany: vi.fn(async () => [{
            id: 'chat-1',
            projectId: 'project-1',
            projectMemorySummary: 'User prefers milestone-based roadmap updates.',
            projectMemorySummaryUpdatedAt: new Date(
              '2026-03-13T10:04:30.000Z',
            ),
            messages: [
              {
                createdAt: new Date('2026-03-13T10:04:00.000Z'),
                role: 'user',
                parts: [
                  {
                    type: 'text',
                    text: 'Please keep roadmap summaries grouped by milestone.',
                  },
                ],
              },
            ],
          }]),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(values => ({
          where: vi.fn(async () => {
            updateCalls.push(values)
          }),
        })),
      })),
    }

    vi.stubGlobal('useDb', () => db)

    await refreshProjectMemory('project-1', 1, db as never)

    expect(mocks.generateText).toHaveBeenCalledTimes(1)
    expect(updateCalls).not.toContainEqual(expect.objectContaining({
      projectMemorySummary: expect.any(String),
    }))
    expect(updateCalls).toContainEqual(expect.objectContaining({
      memoryStatus: 'ready',
      memory: 'Keep roadmap updates milestone-based and concise.',
    }))
  })

  it('keeps memory idle when no durable memory can be synthesized', async () => {
    vi.stubGlobal('useGoogle', vi.fn(async () => ({
      instance: { id: 'google-memory-model' },
    })))

    const { refreshProjectMemory } = await import(
      '../../../server/utils/projects/memory'
    )
    const updateCalls: unknown[] = []
    const db = {
      query: {
        keys: {
          findMany: vi.fn(async () => [{ provider: 'google' }]),
        },
        projects: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({
              id: 'project-1',
              userId: 1,
              name: 'Translator',
              memory: null,
              memoryStatus: 'stale',
              memoryUpdatedAt: null,
              memoryDirtyAt: new Date('2026-03-13T10:00:00.000Z'),
              memoryProvider: null,
              memoryModel: null,
              memoryError: null,
            })
            .mockResolvedValueOnce({
              id: 'project-1',
              memory: null,
              memoryStatus: 'idle',
              memoryUpdatedAt: null,
              memoryDirtyAt: null,
              memoryProvider: 'google',
              memoryModel: googleProjectMemoryModel.id,
              memoryError: null,
            }),
        },
        chats: {
          findMany: vi.fn(async () => []),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(values => ({
          where: vi.fn(async () => {
            updateCalls.push(values)
          }),
        })),
      })),
    }

    vi.stubGlobal('useDb', () => db)

    const result = await refreshProjectMemory('project-1', 1, db as never)

    expect(result).toMatchObject({
      memory: null,
      memoryStatus: 'idle',
      memoryUpdatedAt: null,
      memoryProvider: 'google',
      memoryModel: googleProjectMemoryModel.id,
    })
    expect(updateCalls).toContainEqual(expect.objectContaining({
      memory: null,
      memoryStatus: 'idle',
      memoryUpdatedAt: null,
      memoryProvider: 'google',
      memoryModel: googleProjectMemoryModel.id,
      memoryError: null,
    }))
  })

  it('recomputes stale summaries when newer assistant messages exist', async () => {
    vi.stubGlobal('useGoogle', vi.fn(async () => ({
      instance: { id: 'google-memory-model' },
    })))

    mocks.generateText
      .mockResolvedValueOnce({
        text: 'Roadmap updates should stay milestone-based and concise.',
      })
      .mockResolvedValueOnce({
        text: 'Keep roadmap updates milestone-based and concise.',
      })

    const { refreshProjectMemory } = await import(
      '../../../server/utils/projects/memory'
    )
    const updateCalls: unknown[] = []
    const db = {
      query: {
        keys: {
          findMany: vi.fn(async () => [{ provider: 'google' }]),
        },
        projects: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({
              id: 'project-1',
              userId: 1,
              name: 'Roadmap',
              memory: null,
              memoryStatus: 'stale',
              memoryUpdatedAt: null,
              memoryDirtyAt: new Date('2026-03-13T10:00:00.000Z'),
              memoryProvider: null,
              memoryModel: null,
              memoryError: null,
            })
            .mockResolvedValueOnce({
              id: 'project-1',
              memory: 'Keep roadmap updates milestone-based and concise.',
              memoryStatus: 'ready',
              memoryUpdatedAt: new Date('2026-03-13T10:05:00.000Z'),
              memoryDirtyAt: null,
              memoryProvider: 'google',
              memoryModel: googleProjectMemoryModel.id,
              memoryError: null,
            }),
        },
        chats: {
          findMany: vi.fn(async () => [{
            id: 'chat-1',
            projectId: 'project-1',
            projectMemorySummary: 'Old summary',
            projectMemorySummaryUpdatedAt: new Date(
              '2026-03-13T10:04:30.000Z',
            ),
            messages: [
              {
                createdAt: new Date('2026-03-13T10:04:00.000Z'),
                role: 'user',
                parts: [
                  {
                    type: 'text',
                    text: 'Please keep roadmap summaries grouped by milestone.',
                  },
                ],
              },
              {
                createdAt: new Date('2026-03-13T10:06:00.000Z'),
                role: 'assistant',
                parts: [
                  {
                    type: 'text',
                    text: 'I will keep roadmap updates milestone-based and concise.',
                  },
                ],
              },
            ],
          }]),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(values => ({
          where: vi.fn(async () => {
            updateCalls.push(values)
          }),
        })),
      })),
    }

    vi.stubGlobal('useDb', () => db)

    await refreshProjectMemory('project-1', 1, db as never)

    expect(mocks.generateText).toHaveBeenCalledTimes(2)
    expect(updateCalls).toContainEqual(expect.objectContaining({
      projectMemorySummary: 'Roadmap updates should stay milestone-based and concise.',
      projectMemorySummaryUpdatedAt: expect.any(Date),
    }))
  })
})
