import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  convertFilesForAI,
  loadOwnedGeneratedImageDataUrl,
} from '../../../server/utils/files/convert-files-for-ai'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  getOwnedFilesByStorageKeys: vi.fn(),
  getOwnedGeneratedImageFilesByStorageKeys: vi.fn(),
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

vi.mock('~~/server/utils/files/file-governance', async () => {
  const actual = await vi.importActual<any>(
    '~~/server/utils/files/file-governance',
  )

  return {
    ...actual,
    getOwnedFilesByStorageKeys: mocks.getOwnedFilesByStorageKeys,
    getOwnedGeneratedImageFilesByStorageKeys:
      mocks.getOwnedGeneratedImageFilesByStorageKeys,
  }
})

describe('convertFilesForAI', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('useEvent', () => ({}))
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useUnauthorizedError', () => {
      throw new Error('Unauthorized')
    })
    vi.stubGlobal('useKV', () => ({
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    }))
  })

  it('converts owned file URLs to data URLs', async () => {
    const storageGet = vi.fn().mockResolvedValue({
      arrayBuffer: async () => new TextEncoder().encode('abc').buffer,
    })

    vi.stubGlobal('useFileStorage', () => ({
      get: storageGet,
    }))
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      ['file-1.png', {
        id: 'file-1',
        storageKey: 'file-1.png',
        size: 3,
      }],
    ]))

    const messages: UIMessage[] = [{
      id: 'm1',
      role: 'user',
      parts: [{
        type: 'file',
        url: '/files/file-1.png',
        mediaType: 'image/png',
        filename: 'file-1.png',
      }],
    } as any]

    const result = await convertFilesForAI(messages)
    const convertedUrl = (result.messages[0] as any)?.parts?.[0]?.url

    expect(convertedUrl).toMatch(/^data:image\/png;base64,/)
    expect(result.missingFiles).toHaveLength(0)
    expect(storageGet).toHaveBeenCalledWith('file-1.png')
  })

  it('inlines text files as a markdown text part', async () => {
    const fileContent = '# Heading\n\nSome `inline` code and a fence:\n```\nx\n```\n'
    const storageGet = vi.fn().mockResolvedValue({
      arrayBuffer: async () => new TextEncoder().encode(fileContent).buffer,
      text: async () => fileContent,
    })

    vi.stubGlobal('useFileStorage', () => ({
      get: storageGet,
    }))
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      ['notes-1.md', {
        id: 'file-1',
        storageKey: 'notes-1.md',
        size: fileContent.length,
      }],
    ]))

    const messages: UIMessage[] = [{
      id: 'm1',
      role: 'user',
      parts: [{
        type: 'file',
        url: '/files/notes-1.md',
        mediaType: 'text/plain',
        filename: 'notes.md',
      }],
    } as any]

    const result = await convertFilesForAI(messages)
    const convertedPart = (result.messages[0] as any)?.parts?.[0]

    expect(convertedPart?.type).toBe('text')
    expect(convertedPart?.text).toContain('**notes.md**')
    expect(convertedPart?.text).toContain('````md\n')
    expect(convertedPart?.text).toContain(fileContent)
    expect(convertedPart?.text.endsWith('````')).toBe(true)
    expect(result.missingFiles).toHaveLength(0)
    expect(storageGet).toHaveBeenCalledWith('notes-1.md')
  })

  it('reports text files missing from storage', async () => {
    const storageGet = vi.fn().mockResolvedValue(null)

    vi.stubGlobal('useFileStorage', () => ({
      get: storageGet,
    }))
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      ['notes-2.txt', {
        id: 'file-2',
        storageKey: 'notes-2.txt',
        size: 0,
      }],
    ]))

    const messages: UIMessage[] = [{
      id: 'm1',
      role: 'user',
      parts: [{
        type: 'file',
        url: '/files/notes-2.txt',
        mediaType: 'text/plain',
        filename: 'notes.txt',
      }],
    } as any]

    const result = await convertFilesForAI(messages)

    expect(result.missingFiles).toEqual([{
      storageKey: 'notes-2.txt',
      filename: 'notes.txt',
    }])
    expect((result.messages[0] as any)?.parts).toHaveLength(0)
  })

  it('treats foreign storage keys as missing without reading R2', async () => {
    const storageGet = vi.fn()

    vi.stubGlobal('useFileStorage', () => ({
      get: storageGet,
    }))
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map())

    const messages: UIMessage[] = [{
      id: 'm1',
      role: 'user',
      parts: [{
        type: 'file',
        url: '/files/foreign-file.png',
        mediaType: 'image/png',
        filename: 'foreign-file.png',
      }],
    } as any]

    const result = await convertFilesForAI(messages)

    expect(result.missingFiles).toEqual([{
      storageKey: 'foreign-file.png',
      filename: 'foreign-file.png',
    }])
    expect(storageGet).not.toHaveBeenCalled()
  })
})

describe('loadOwnedGeneratedImageDataUrl', () => {
  const logger = { set: vi.fn() }

  function stubKv(cached: string | null = null) {
    const kv = {
      get: vi.fn().mockResolvedValue(cached),
      put: vi.fn().mockResolvedValue(undefined),
    }

    vi.stubGlobal('useKV', () => kv)

    return kv
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useEvent', () => {
      throw new Error('useEvent must not be called')
    })
  })

  it('loads an owned generated image once and caches the data url',
    async () => {
      const kv = stubKv()
      const storage = {
        get: vi.fn().mockResolvedValue({
          arrayBuffer: async () => new TextEncoder().encode('abc').buffer,
        }),
      }

      mocks.getOwnedGeneratedImageFilesByStorageKeys.mockResolvedValue(
        new Map([['gen-1.webp', { storageKey: 'gen-1.webp', type: 'image/webp' }]]),
      )

      const dataUrl = await loadOwnedGeneratedImageDataUrl({
        userId: 7,
        storageKey: 'gen-1.webp',
        storage: storage as never,
        logger,
      })

      expect(dataUrl).toMatch(/^data:image\/webp;base64,/)
      expect(mocks.getOwnedGeneratedImageFilesByStorageKeys)
        .toHaveBeenCalledWith(7, ['gen-1.webp'])
      expect(storage.get).toHaveBeenCalledTimes(1)
      expect(kv.put).toHaveBeenCalledTimes(1)
    },
  )

  it('returns the cached data url without reading storage', async () => {
    stubKv('data:image/webp;base64,Y2FjaGVk')

    const storage = { get: vi.fn() }

    mocks.getOwnedGeneratedImageFilesByStorageKeys.mockResolvedValue(
      new Map([['gen-1.webp', { storageKey: 'gen-1.webp', type: 'image/webp' }]]),
    )

    const dataUrl = await loadOwnedGeneratedImageDataUrl({
      userId: 7,
      storageKey: 'gen-1.webp',
      storage: storage as never,
      logger,
    })

    expect(dataUrl).toBe('data:image/webp;base64,Y2FjaGVk')
    expect(storage.get).not.toHaveBeenCalled()
  })

  it('returns null for a file the user does not own', async () => {
    stubKv()

    const storage = { get: vi.fn() }

    mocks.getOwnedGeneratedImageFilesByStorageKeys.mockResolvedValue(new Map())

    const dataUrl = await loadOwnedGeneratedImageDataUrl({
      userId: 7,
      storageKey: 'foreign.webp',
      storage: storage as never,
      logger,
    })

    expect(dataUrl).toBeNull()
    expect(storage.get).not.toHaveBeenCalled()
  })

  it('returns null when the object is gone from storage', async () => {
    const kv = stubKv()
    const storage = { get: vi.fn().mockResolvedValue(null) }

    mocks.getOwnedGeneratedImageFilesByStorageKeys.mockResolvedValue(
      new Map([['gen-1.webp', { storageKey: 'gen-1.webp', type: 'image/webp' }]]),
    )

    const dataUrl = await loadOwnedGeneratedImageDataUrl({
      userId: 7,
      storageKey: 'gen-1.webp',
      storage: storage as never,
      logger,
    })

    expect(dataUrl).toBeNull()
    expect(kv.put).not.toHaveBeenCalled()
  })
})
