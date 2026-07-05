import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { rewriteShareFileParts } from '../../../server/utils/files/rewrite-share-file-urls'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  filesFindMany: vi.fn(),
  createFileAccessToken: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('~~/server/utils/files/file-share-access', () => ({
  createFileAccessToken: mocks.createFileAccessToken,
}))

describe('rewriteShareFileParts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useEvent', () => ({}))
    vi.stubGlobal('useDb', () => ({
      query: {
        files: {
          findMany: mocks.filesFindMany,
        },
      },
    }))
  })

  it('appends a minted token to resolvable file part urls', async () => {
    mocks.filesFindMany.mockResolvedValue([
      { id: 'file-1', storageKey: 'owned.png' },
    ])
    mocks.createFileAccessToken.mockResolvedValue('token-abc')

    const messages = [{
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'file', url: '/files/owned.png', mediaType: 'image/png' },
      ],
    }] as unknown as UIMessage[]

    const result = await rewriteShareFileParts(messages, 'share-1')

    expect(mocks.createFileAccessToken).toHaveBeenCalledWith(
      {
        shareId: 'share-1',
        fileId: 'file-1',
        expiresInSeconds: 3600,
      },
      expect.anything(),
    )
    expect((result[0]?.parts[0] as any)?.url).toBe(
      '/files/owned.png?token=token-abc',
    )
  })

  it('uses an ampersand separator when the url already has a query', async () => {
    mocks.filesFindMany.mockResolvedValue([
      { id: 'file-1', storageKey: 'owned.png' },
    ])
    mocks.createFileAccessToken.mockResolvedValue('token-abc')

    const messages = [{
      id: 'm1',
      role: 'assistant',
      parts: [
        {
          type: 'file',
          url: '/files/owned.png?variant=thumb',
          mediaType: 'image/png',
        },
      ],
    }] as unknown as UIMessage[]

    const result = await rewriteShareFileParts(messages, 'share-1')

    expect((result[0]?.parts[0] as any)?.url).toBe(
      '/files/owned.png?variant=thumb&token=token-abc',
    )
  })

  it('drops file parts that cannot be resolved to an owned file', async () => {
    mocks.filesFindMany.mockResolvedValue([])

    const messages = [{
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'file', url: '/files/missing.png', mediaType: 'image/png' },
      ],
    }] as unknown as UIMessage[]

    const result = await rewriteShareFileParts(messages, 'share-1')

    expect(result[0]?.parts).toEqual([])
    expect(mocks.createFileAccessToken).not.toHaveBeenCalled()
  })

  it('leaves non-file parts untouched', async () => {
    mocks.filesFindMany.mockResolvedValue([])

    const messages = [{
      id: 'm1',
      role: 'user',
      parts: [
        { type: 'text', text: 'hello world' },
      ],
    }] as unknown as UIMessage[]

    const result = await rewriteShareFileParts(messages, 'share-1')

    expect(result[0]?.parts).toEqual([
      { type: 'text', text: 'hello world' },
    ])
    expect(mocks.filesFindMany).not.toHaveBeenCalled()
  })

  it('reuses a single minted token for multiple parts referencing the same file', async () => {
    mocks.filesFindMany.mockResolvedValue([
      { id: 'file-1', storageKey: 'owned.png' },
    ])
    mocks.createFileAccessToken.mockResolvedValue('token-abc')

    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          { type: 'file', url: '/files/owned.png', mediaType: 'image/png' },
        ],
      },
      {
        id: 'm2',
        role: 'assistant',
        parts: [
          { type: 'file', url: '/files/owned.png', mediaType: 'image/png' },
        ],
      },
    ] as unknown as UIMessage[]

    await rewriteShareFileParts(messages, 'share-1')

    expect(mocks.createFileAccessToken).toHaveBeenCalledTimes(1)
  })
})
