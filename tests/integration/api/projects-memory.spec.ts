import { beforeEach, describe, expect, it, vi } from 'vitest'
import googleProvider from '../../../providers/google'

const googleProjectMemoryModel = googleProvider.models.find((model) => {
  return model.forProjectMemory
})

if (!googleProjectMemoryModel) {
  throw new Error('Project memory model must be configured in providers')
}

const mocks = vi.hoisted(() => ({
  refreshProjectMemoryFromChats: vi.fn(),
  toggleProjectMemory: vi.fn(),
  buildProjectMemoryCard: vi.fn(),
  setProjectUseAccountMemory: vi.fn(),
  assertNotCrossSiteRequest: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: vi.fn(),
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  createError: (input: {
    message?: string
    status?: number
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/projects/memory-refresh', () => ({
  refreshProjectMemoryFromChats: mocks.refreshProjectMemoryFromChats,
  toggleProjectMemory: mocks.toggleProjectMemory,
}))

vi.mock('~~/server/utils/projects/memory-account', () => ({
  setProjectUseAccountMemory: mocks.setProjectUseAccountMemory,
}))

vi.mock('~~/server/utils/projects/memory-card', () => ({
  buildProjectMemoryCard: mocks.buildProjectMemoryCard,
}))

function createCard(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'project-1',
    memoryStatus: 'ready',
    memoryUpdatedAt: '2026-03-13T09:00:00.000Z',
    memoryDirtyAt: null,
    memoryProvider: 'google',
    memoryModel: googleProjectMemoryModel!.id,
    memoryError: null,
    usesEntries: true,
    useAccountMemory: true,
    legacyMemory: null,
    total: 1,
    limits: {},
    groups: [],
    ...overrides,
  }
}

async function getRefreshProjectMemoryHandler() {
  const module = await import(
    '../../../server/api/v1/projects/[id]/memory/refresh.post'
  )

  return module.default
}

async function getToggleProjectMemoryHandler() {
  const module = await import(
    '../../../server/api/v1/projects/[id]/memory/index.patch'
  )

  return module.default
}

async function getProjectMemoryCardHandler() {
  const module = await import(
    '../../../server/api/v1/projects/[id]/memory/index.get'
  )

  return module.default
}

describe('project memory API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.refreshProjectMemoryFromChats.mockResolvedValue(createCard())
    mocks.buildProjectMemoryCard.mockResolvedValue(createCard())
    mocks.setProjectUseAccountMemory.mockImplementation(
      async (_projectId: string, _userId: number, value: boolean) => {
        return createCard({ useAccountMemory: value })
      },
    )
    mocks.toggleProjectMemory.mockImplementation(
      async (_projectId: string, _userId: number, enabled: boolean) => {
        return createCard({
          memoryStatus: enabled ? 'ready' : 'disabled',
          memoryUpdatedAt: enabled ? '2026-03-13T09:00:00.000Z' : null,
          memoryProvider: enabled ? 'google' : null,
          memoryModel: enabled ? googleProjectMemoryModel!.id : null,
        })
      },
    )

    vi.stubGlobal('assertNotCrossSiteRequest', mocks.assertNotCrossSiteRequest)
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('createError', (input: {
      statusCode?: number
      statusMessage?: string
      message?: string
      status?: number
      why?: string
    }) => {
      const exception = new Error(
        input.message || input.statusMessage || 'Error',
      )

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw (globalThis as any).createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
      })
    })
    vi.stubGlobal('getRouterParams', (
      event: { params: unknown },
    ) => {
      return event.params
    })
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => {
      return parser(event.body)
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useDb', () => ({ marker: 'db' }))
  })

  it('refreshes project memory for a project and returns the card', async () => {
    const handler = await getRefreshProjectMemoryHandler()

    const response = await handler({
      params: { id: 'project-1' },
    } as never)

    expect(mocks.refreshProjectMemoryFromChats).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 1,
      logger: expect.objectContaining({ set: expect.any(Function) }),
    })
    expect(response).toMatchObject({
      projectId: 'project-1',
      memoryStatus: 'ready',
      memoryProvider: 'google',
      memoryModel: googleProjectMemoryModel!.id,
      usesEntries: true,
    })
  })

  it('returns the project memory card for the signed-in owner', async () => {
    const handler = await getProjectMemoryCardHandler()

    const response = await handler({
      params: { id: 'project-1' },
    } as never)

    expect(mocks.buildProjectMemoryCard).toHaveBeenCalledWith(
      'project-1',
      1,
      { marker: 'db' },
      expect.objectContaining({ set: expect.any(Function) }),
    )
    expect(response).toEqual(createCard())
  })

  it('rejects the project memory card without a session', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const handler = await getProjectMemoryCardHandler()

    await expect(handler({
      params: { id: 'project-1' },
    } as never)).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.buildProjectMemoryCard).not.toHaveBeenCalled()
  })

  it('toggles project memory enabled state and returns the card', async () => {
    const handler = await getToggleProjectMemoryHandler()

    const disabledResponse = await handler({
      params: { id: 'project-1' },
      body: { enabled: false },
    } as never)
    const enabledResponse = await handler({
      params: { id: 'project-1' },
      body: { enabled: true },
    } as never)

    expect(disabledResponse).toMatchObject({
      memoryStatus: 'disabled',
      memoryUpdatedAt: null,
      memoryProvider: null,
      memoryModel: null,
    })
    expect(enabledResponse).toMatchObject({
      memoryStatus: 'ready',
      memoryUpdatedAt: '2026-03-13T09:00:00.000Z',
      memoryProvider: 'google',
      memoryModel: googleProjectMemoryModel!.id,
    })
  })

  it('returns useAccountMemory on the project memory card', async () => {
    mocks.buildProjectMemoryCard.mockResolvedValue(
      createCard({ useAccountMemory: false }),
    )

    const handler = await getProjectMemoryCardHandler()
    const response = await handler({ params: { id: 'project-1' } } as never)

    expect(response).toMatchObject({ useAccountMemory: false })
  })

  it('turns account memory sharing off and on without toggling memory',
    async () => {
      const handler = await getToggleProjectMemoryHandler()

      const offResponse = await handler({
        params: { id: 'project-1' },
        body: { useAccountMemory: false },
      } as never)
      const onResponse = await handler({
        params: { id: 'project-1' },
        body: { useAccountMemory: true },
      } as never)

      expect(mocks.setProjectUseAccountMemory).toHaveBeenNthCalledWith(
        1,
        'project-1',
        1,
        false,
        undefined,
        expect.objectContaining({ set: expect.any(Function) }),
      )
      expect(mocks.setProjectUseAccountMemory).toHaveBeenNthCalledWith(
        2,
        'project-1',
        1,
        true,
        undefined,
        expect.objectContaining({ set: expect.any(Function) }),
      )
      expect(mocks.toggleProjectMemory).not.toHaveBeenCalled()
      expect(offResponse).toMatchObject({
        projectId: 'project-1',
        memoryStatus: 'ready',
        useAccountMemory: false,
      })
      expect(onResponse).toMatchObject({ useAccountMemory: true })
    })

  it('applies both fields in one request and returns the toggle card',
    async () => {
      const handler = await getToggleProjectMemoryHandler()

      const response = await handler({
        params: { id: 'project-1' },
        body: { enabled: false, useAccountMemory: false },
      } as never)

      expect(mocks.setProjectUseAccountMemory).toHaveBeenCalledTimes(1)
      expect(mocks.toggleProjectMemory).toHaveBeenCalledWith(
        'project-1',
        1,
        false,
        undefined,
        expect.objectContaining({ set: expect.any(Function) }),
      )
      expect(response).toMatchObject({ memoryStatus: 'disabled' })
    })

  it('does not touch account memory when only enabled is sent', async () => {
    const handler = await getToggleProjectMemoryHandler()

    await handler({
      params: { id: 'project-1' },
      body: { enabled: true },
    } as never)

    expect(mocks.setProjectUseAccountMemory).not.toHaveBeenCalled()
    expect(mocks.toggleProjectMemory).toHaveBeenCalledTimes(1)
  })

  it('propagates a 404 for a foreign or missing project', async () => {
    mocks.setProjectUseAccountMemory.mockRejectedValue(
      (globalThis as any).createError({
        status: 404,
        message: 'Project not found',
      }),
    )

    const handler = await getToggleProjectMemoryHandler()

    await expect(handler({
      params: { id: 'foreign-project' },
      body: { useAccountMemory: false },
    } as never)).rejects.toMatchObject({ status: 404 })
    expect(mocks.toggleProjectMemory).not.toHaveBeenCalled()
  })

  it('rejects an empty or invalid body before doing any work', async () => {
    const handler = await getToggleProjectMemoryHandler()
    const invalidBodies = [
      {},
      { useAccountMemory: 'no' },
      { enabled: 'yes' },
      { useAccountMemory: null },
      { enabled: 'yes', useAccountMemory: false },
    ]

    for (const body of invalidBodies) {
      await expect(handler({
        params: { id: 'project-1' },
        body,
      } as never)).rejects.toMatchObject({ status: 400 })
    }

    expect(mocks.setProjectUseAccountMemory).not.toHaveBeenCalled()
    expect(mocks.toggleProjectMemory).not.toHaveBeenCalled()
  })

  it('rejects an account memory change without a session', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const handler = await getToggleProjectMemoryHandler()

    await expect(handler({
      params: { id: 'project-1' },
      body: { useAccountMemory: false },
    } as never)).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.setProjectUseAccountMemory).not.toHaveBeenCalled()
  })

  it('rejects a cross-site account memory change', async () => {
    mocks.assertNotCrossSiteRequest.mockImplementation(() => {
      throw (globalThis as any).createError({ status: 403, message: 'Forbidden' })
    })

    const handler = await getToggleProjectMemoryHandler()

    await expect(handler({
      params: { id: 'project-1' },
      body: { useAccountMemory: false },
    } as never)).rejects.toMatchObject({ status: 403 })
    expect(mocks.setProjectUseAccountMemory).not.toHaveBeenCalled()
  })

  it('rejects a cross-site refresh and toggle before doing any work', async () => {
    mocks.assertNotCrossSiteRequest.mockImplementation(() => {
      throw (globalThis as any).createError({ status: 403, message: 'Forbidden' })
    })

    const refreshHandler = await getRefreshProjectMemoryHandler()
    const toggleHandler = await getToggleProjectMemoryHandler()

    await expect(refreshHandler({
      params: { id: 'project-1' },
    } as never)).rejects.toMatchObject({ status: 403 })
    await expect(toggleHandler({
      params: { id: 'project-1' },
      body: { enabled: true },
    } as never)).rejects.toMatchObject({ status: 403 })
    expect(mocks.refreshProjectMemoryFromChats).not.toHaveBeenCalled()
    expect(mocks.toggleProjectMemory).not.toHaveBeenCalled()
  })

  it('guards the refresh and toggle routes against cross-site calls', async () => {
    const refreshHandler = await getRefreshProjectMemoryHandler()
    const toggleHandler = await getToggleProjectMemoryHandler()

    await refreshHandler({ params: { id: 'project-1' } } as never)
    await toggleHandler({
      params: { id: 'project-1' },
      body: { enabled: true },
    } as never)

    expect(mocks.assertNotCrossSiteRequest).toHaveBeenCalledTimes(2)
  })
})
