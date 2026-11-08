import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { HIDDEN_FILE_MEDIA_TYPE } from '#shared/utils/files'
import { createChatContextTestDb } from '../../../setup/helpers/chat-context-db'
import type { ChatContextTestDb } from '../../../setup/helpers/chat-context-db'

const mocks = vi.hoisted(() => ({
  rewriteShareFileParts: vi.fn(),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: vi.fn() }),
}))

vi.mock(
  '~~/server/utils/files/rewrite-share-file-urls',
  async (importOriginal) => {
    const original = await importOriginal<
      typeof import('~~/server/utils/files/rewrite-share-file-urls')
    >()

    return {
      ...original,
      rewriteShareFileParts: mocks.rewriteShareFileParts,
    }
  },
)

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const SHARE_SLUG = 'share-slug'
const USAGE = {
  model: 'gpt-5.4',
  provider: 'openai',
  inputTokens: 100,
  outputTokens: 100,
  totalTokens: 200,
  inputCost: 0.01,
  outputCost: 0.02,
}

interface PartWithUrl {
  type: string
  url?: string
}

async function loadHandler() {
  const module = await import('~~/server/api/v1/shared/[slug]/context.get')

  return module.default as unknown as (
    event: { params: Record<string, string>, context: object },
  ) => Promise<Record<string, any>>
}

function createEvent(slug: string) {
  return { params: { slug }, context: {} }
}

function stubServerGlobals(testDb: ChatContextTestDb) {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('z', z)
  vi.stubGlobal('useDb', () => testDb.db)
  vi.stubGlobal('useEvent', () => ({ context: {} }))
  vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
    return event.params
  })
}

function mockShareFileRewrite() {
  mocks.rewriteShareFileParts.mockImplementation(async (
    rows: Array<{ parts: PartWithUrl[] }>,
  ) => {
    return rows.map((row) => {
      return {
        ...row,
        parts: row.parts.map((part) => {
          if (part.type !== 'file' || !part.url) {
            return part
          }

          const storageKey = part.url.replace('/files/', '')

          return { ...part, url: `/api/v1/shared/files/token-${storageKey}` }
        }),
      }
    })
  })
}

function seedSharedChat(
  testDb: ChatContextTestDb,
  share: Partial<Parameters<ChatContextTestDb['insertShare']>[0]> = {},
) {
  testDb.insertChat({ id: 1, userId: 7, slug: CHAT_SLUG, title: 'Shared' })
  testDb.insertShare({ id: 1, chatId: 1, slug: SHARE_SLUG, ...share })
  testDb.insertMessage({
    id: 1,
    chatId: 1,
    role: 'user',
    parts: [
      { type: 'text', text: 'Look' },
      {
        type: 'file',
        url: '/files/key-1',
        mediaType: 'application/pdf',
        filename: 'report.pdf',
      },
    ],
  })
  testDb.insertMessage({
    id: 2,
    chatId: 1,
    role: 'assistant',
    parts: [
      {
        type: 'file',
        url: '/files/key-2',
        mediaType: 'image/png',
        filename: 'cat.png',
      },
      {
        type: 'tool-generate_image',
        toolCallId: 'call-1',
        state: 'output-available',
        output: {
          status: 'ready',
          file: { id: 'file-9', name: 'tool.png', url: '/files/key-3' },
        },
      },
      {
        type: 'tool-memory_write',
        toolCallId: 'call-2',
        state: 'output-available',
        input: { title: 'Private fact' },
      },
      {
        type: 'tool-search_chats',
        toolCallId: 'call-3',
        state: 'output-available',
        input: { query: 'private query' },
      },
      {
        type: 'tool-search_project_knowledge',
        toolCallId: 'call-4',
        state: 'output-available',
        output: { hits: [{ itemId: 'item-1', title: 'Internal doc' }] },
      },
      { type: 'tool-web_search_brave', toolCallId: 'call-5' },
      { type: 'source-url', url: 'https://example.com/a', title: 'A' },
      { type: 'source-url', url: 'https://example.com/a', title: 'A again' },
      { type: 'source-url', url: 'ftp://files.test/b' },
      { type: 'data-research', data: { provider: 'openai', level: 'quick' } },
      { type: 'text', text: 'Done' },
    ],
    tools: ['web_search_brave'],
    usage: USAGE,
  })
}

describe('GET /api/v1/shared/[slug]/context', () => {
  let testDb: ChatContextTestDb

  beforeEach(() => {
    vi.resetModules()
    mocks.rewriteShareFileParts.mockReset()
    mockShareFileRewrite()
    testDb = createChatContextTestDb()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  it('answers 404 for an unknown share slug', async () => {
    seedSharedChat(testDb)
    stubServerGlobals(testDb)

    const handler = await loadHandler()

    await expect(handler(createEvent('unknown')))
      .rejects.toMatchObject({
        status: 404,
        message: 'Shared chat not found',
      })
  })

  it('answers 404 for a revoked share', async () => {
    seedSharedChat(testDb, { revoked: true })
    stubServerGlobals(testDb)

    const handler = await loadHandler()

    await expect(handler(createEvent(SHARE_SLUG)))
      .rejects.toMatchObject({ status: 404 })
    expect(mocks.rewriteShareFileParts).not.toHaveBeenCalled()
  })

  it('answers 404 for an expired share', async () => {
    seedSharedChat(testDb, { expiresAtSeconds: 1_000_000_000 })
    stubServerGlobals(testDb)

    const handler = await loadHandler()

    await expect(handler(createEvent(SHARE_SLUG)))
      .rejects.toMatchObject({ status: 404 })
  })

  it('serves a share whose expiry is still in the future', async () => {
    seedSharedChat(testDb, {
      expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600,
    })
    stubServerGlobals(testDb)

    const handler = await loadHandler()
    const response = await handler(createEvent(SHARE_SLUG))

    expect(response.chat.title).toBe('Shared')
  })

  it('answers 404 when the shared chat row is gone', async () => {
    testDb.insertShare({ id: 1, chatId: 99, slug: SHARE_SLUG })
    stubServerGlobals(testDb)

    const handler = await loadHandler()

    await expect(handler(createEvent(SHARE_SLUG)))
      .rejects.toMatchObject({ status: 404 })
  })

  it('answers 400 for an empty slug', async () => {
    stubServerGlobals(testDb)

    const handler = await loadHandler()

    await expect(handler(createEvent('')))
      .rejects.toMatchObject({
        status: 400,
        message: 'Invalid request parameters',
      })
  })

  it('needs no session and returns the public sections only', async () => {
    seedSharedChat(testDb)
    stubServerGlobals(testDb)

    const handler = await loadHandler()
    const response = await handler(createEvent(SHARE_SLUG))

    expect(response.chat).toMatchObject({
      slug: SHARE_SLUG,
      title: 'Shared',
      models: ['gpt-5.4'],
      allowBranch: true,
    })
    expect(response.inputs.map((item: { title: string }) => {
      return item.title
    })).toEqual(['report.pdf'])
    expect(response.outputs.map((item: { kind: string }) => {
      return item.kind
    })).toEqual(['image', 'research'])
    expect(response.used.map((item: { kind: string }) => {
      return item.kind
    })).toEqual(['web-source'])
    expect(response.counts).toEqual({ outputs: 2, inputs: 1, used: 1 })
  })

  it('never exposes tool-derived items, even with every option on',
    async () => {
      seedSharedChat(testDb)
      stubServerGlobals(testDb)

      const handler = await loadHandler()
      const response = await handler(createEvent(SHARE_SLUG))
      const serialized = JSON.stringify(response)
      const sectionIds = [
        ...response.outputs,
        ...response.inputs,
        ...response.used,
      ].map((item: { sectionId: string }) => {
        return item.sectionId
      })

      expect(sectionIds).not.toContain('memory')
      expect(sectionIds).not.toContain('chat-search')
      expect(sectionIds).not.toContain('project-knowledge')
      expect(serialized).not.toContain('Private fact')
      expect(serialized).not.toContain('private query')
      expect(serialized).not.toContain('Internal doc')
      expect(serialized).not.toContain('tool.png')
      expect(serialized).not.toContain('web-search:')
    })

  it('rewrites file urls so a raw storage url never leaks', async () => {
    seedSharedChat(testDb)
    stubServerGlobals(testDb)

    const handler = await loadHandler()
    const response = await handler(createEvent(SHARE_SLUG))

    expect(mocks.rewriteShareFileParts).toHaveBeenCalledOnce()
    expect(mocks.rewriteShareFileParts.mock.calls[0]?.[1]).toBe('pub-1')
    expect(response.inputs[0].meta.url)
      .toBe('/api/v1/shared/files/token-key-1')
    expect(response.outputs[0].meta.url)
      .toBe('/api/v1/shared/files/token-key-2')
    expect(JSON.stringify(response)).not.toContain('/files/key-')
  })

  it('hides every file when the share does not show files', async () => {
    seedSharedChat(testDb, { showFiles: false })
    stubServerGlobals(testDb)

    const handler = await loadHandler()
    const response = await handler(createEvent(SHARE_SLUG))

    expect(mocks.rewriteShareFileParts).not.toHaveBeenCalled()
    expect(response.inputs).toEqual([])
    expect(response.outputs.map((item: { kind: string }) => {
      return item.kind
    })).toEqual(['research'])
    expect(response.used.map((item: { kind: string }) => {
      return item.kind
    })).toEqual(['web-source'])
    expect(JSON.stringify(response)).not.toContain('report.pdf')
    expect(JSON.stringify(response)).not.toContain('/files/')
    expect(JSON.stringify(response)).not.toContain(HIDDEN_FILE_MEDIA_TYPE)
  })

  it('gives a null cost and no models when metadata is hidden', async () => {
    seedSharedChat(testDb, { showMetadata: false })
    stubServerGlobals(testDb)

    const handler = await loadHandler()
    const response = await handler(createEvent(SHARE_SLUG))

    expect(response.chat.cost).toBeNull()
    expect(response.chat.models).toEqual([])
  })

  it('reports the chat total cost when metadata is shown', async () => {
    seedSharedChat(testDb)
    stubServerGlobals(testDb)

    const handler = await loadHandler()
    const response = await handler(createEvent(SHARE_SLUG))

    expect(response.chat.cost.amount).toBeCloseTo(0.03)
    expect(response.chat.cost.isEstimated).toBe(false)
  })

  it('is not truncated for a normal chat', async () => {
    seedSharedChat(testDb)
    stubServerGlobals(testDb)

    const handler = await loadHandler()
    const response = await handler(createEvent(SHARE_SLUG))

    expect(response.truncated).toBe(false)
  })

  it('reads only the newest 1000 messages and says so', async () => {
    testDb.insertChat({ id: 1, userId: 7, slug: CHAT_SLUG, title: 'Long' })
    testDb.insertShare({ id: 1, chatId: 1, slug: SHARE_SLUG })

    for (let id = 1; id <= 1001; id += 1) {
      testDb.insertMessage({
        id,
        chatId: 1,
        role: 'assistant',
        parts: [
          { type: 'source-url', url: `https://example.com/${id}` },
        ],
      })
    }

    stubServerGlobals(testDb)

    const handler = await loadHandler()
    const response = await handler(createEvent(SHARE_SLUG))

    expect(response.truncated).toBe(true)
    expect(response.counts.used).toBe(1000)
    expect(response.used).toHaveLength(200)
    expect(response.used[0].href).toBe('https://example.com/802')
  })

  it('reports whether branching is allowed', async () => {
    seedSharedChat(testDb, { allowBranch: false })
    stubServerGlobals(testDb)

    const handler = await loadHandler()
    const response = await handler(createEvent(SHARE_SLUG))

    expect(response.chat.allowBranch).toBe(false)
  })

  it('does not return owner-only chat fields', async () => {
    seedSharedChat(testDb)
    stubServerGlobals(testDb)

    const handler = await loadHandler()
    const response = await handler(createEvent(SHARE_SLUG))

    expect(Object.keys(response.chat).sort()).toEqual([
      'allowBranch',
      'cost',
      'models',
      'slug',
      'title',
    ])
    expect(JSON.stringify(response)).not.toContain(CHAT_SLUG)
  })
})
