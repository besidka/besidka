import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createRequestLogger: vi.fn(),
  loggerSet: vi.fn(),
  loggerEmit: vi.fn<() => unknown>(() => ({ wide: true })),
  recordFirstChatMessageActivation: vi.fn<
    () => Promise<'fired' | 'skipped' | 'failed'>
  >(async () => 'fired'),
  shipWideEventToAxiom: vi.fn(async () => undefined),
}))

vi.mock('evlog', () => ({
  createRequestLogger: mocks.createRequestLogger,
}))

vi.mock('~~/server/utils/analytics/activation', () => ({
  recordFirstChatMessageActivation: mocks.recordFirstChatMessageActivation,
}))

vi.mock('~~/server/utils/evlog-drains', () => ({
  shipWideEventToAxiom: mocks.shipWideEventToAxiom,
}))

async function importTracker() {
  return import('../../../../server/utils/analytics/chat-activation')
}

const PATH = '/api/v1/chats/01ARZ3NDEKTSV4RRFFQ69G5FAV'

describe('trackFirstChatMessage', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.loggerEmit.mockReturnValue({ wide: true })
    mocks.recordFirstChatMessageActivation.mockResolvedValue('fired')
    mocks.createRequestLogger.mockImplementation(() => ({
      set: mocks.loggerSet,
      emit: mocks.loggerEmit,
    }))
  })

  it('uses a standalone logger carrying the flat user id', async () => {
    const waitUntil = vi.fn()
    const { trackFirstChatMessage } = await importTracker()

    await trackFirstChatMessage({
      userId: 41,
      providerId: 'openai',
      path: PATH,
      parentRequestId: 'parent-1',
      waitUntil,
    })

    expect(mocks.createRequestLogger).toHaveBeenCalledExactlyOnceWith({
      method: 'POST',
      path: PATH,
      waitUntil,
    })
    expect(mocks.loggerSet).toHaveBeenCalledWith(expect.objectContaining({
      userId: 41,
      _parentRequestId: 'parent-1',
    }))
    expect(mocks.recordFirstChatMessageActivation)
      .toHaveBeenCalledExactlyOnceWith(
        41,
        'openai',
        expect.objectContaining({ set: mocks.loggerSet }),
      )
  })

  it('emits and ships the event when the activation fired', async () => {
    const { trackFirstChatMessage } = await importTracker()

    await trackFirstChatMessage({
      userId: 41,
      providerId: 'openai',
      path: PATH,
      waitUntil: vi.fn(),
    })

    expect(mocks.loggerEmit).toHaveBeenCalledOnce()
    expect(mocks.shipWideEventToAxiom)
      .toHaveBeenCalledExactlyOnceWith({ wide: true })
  })

  it('emits and ships the event when the activation failed', async () => {
    mocks.recordFirstChatMessageActivation.mockResolvedValue('failed')

    const { trackFirstChatMessage } = await importTracker()

    await trackFirstChatMessage({
      userId: 41,
      providerId: 'openai',
      path: PATH,
      waitUntil: vi.fn(),
    })

    expect(mocks.loggerEmit).toHaveBeenCalledOnce()
    expect(mocks.shipWideEventToAxiom).toHaveBeenCalledOnce()
  })

  it('neither emits nor ships on the steady-state skip', async () => {
    mocks.recordFirstChatMessageActivation.mockResolvedValue('skipped')

    const { trackFirstChatMessage } = await importTracker()

    await trackFirstChatMessage({
      userId: 41,
      providerId: 'openai',
      path: PATH,
      waitUntil: vi.fn(),
    })

    expect(mocks.loggerEmit).not.toHaveBeenCalled()
    expect(mocks.shipWideEventToAxiom).not.toHaveBeenCalled()
  })

  it('emits without shipping when waitUntil is unavailable', async () => {
    const { trackFirstChatMessage } = await importTracker()

    await trackFirstChatMessage({
      userId: 41,
      providerId: 'openai',
      path: PATH,
    })

    expect(mocks.loggerEmit).toHaveBeenCalledOnce()
    expect(mocks.shipWideEventToAxiom).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    mocks.createRequestLogger.mockImplementation(() => {
      throw new Error('logger unavailable')
    })

    const { trackFirstChatMessage } = await importTracker()

    await expect(trackFirstChatMessage({
      userId: 41,
      providerId: 'openai',
      path: PATH,
    })).resolves.toBeUndefined()
  })
})
