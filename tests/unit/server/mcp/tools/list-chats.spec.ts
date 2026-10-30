import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  authWithScopes,
  parseToolResult,
  registerChatToolContractTests,
  stubMcpToolGlobals,
} from './chat-tool-contract'
import type { McpToolShape } from './chat-tool-contract'

const mocks = vi.hoisted(() => {
  return {
    logger: { set: vi.fn(), error: vi.fn() },
    enforceMcpToolRateLimit: vi.fn(),
    requireMcpLegalConsent: vi.fn(),
    listMcpChats: vi.fn(),
  }
})

vi.mock('nitropack/runtime', () => {
  return {
    defineCachedFunction: vi.fn(),
    useNitroApp: vi.fn(),
    useStorage: vi.fn(),
  }
})

vi.mock('~~/server/utils/logging/request-logger', () => {
  return { useRequestLogger: () => mocks.logger }
})

vi.mock('~~/server/utils/mcp/auth', () => {
  return { resolveMcpSiteUrl: () => 'https://besidka.com' }
})

vi.mock('~~/server/utils/mcp/private-access', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private-access')
  >()

  return {
    ...original,
    enforceMcpToolRateLimit: mocks.enforceMcpToolRateLimit,
    requireMcpLegalConsent: mocks.requireMcpLegalConsent,
  }
})

vi.mock('~~/server/utils/mcp/private/chats', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/chats')
  >()

  return { ...original, listMcpChats: mocks.listMcpChats }
})

const SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FA1'

async function loadTool(context: Record<string, unknown>) {
  stubMcpToolGlobals(context)

  const module = await import('~~/server/mcp/tools/list-chats')

  return module.default as unknown as McpToolShape
}

describe('list_chats tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.listMcpChats.mockReset()
    mocks.listMcpChats.mockResolvedValue({
      chats: [{ slug: SLUG, pinned: true, shared: false }],
      nextCursor: null,
    })
  })

  registerChatToolContractTests({
    name: 'list_chats',
    scope: 'chats:read',
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    descriptionIncludes: ['pinned', 'shared', 'projectId', 'pinnedOnly'],
    validInput: {},
    mocks,
    domainMock: mocks.listMcpChats,
    load: loadTool,
  })

  it('keeps the existing inputs and adds the project and pinned filters',
    async () => {
      const { inputSchema } = await loadTool({
        mcpAuth: authWithScopes(['chats:read']),
      })
      const schema = z.object(inputSchema)

      expect(schema.safeParse({}).success).toBe(true)
      expect(schema.safeParse({
        cursor: 'c',
        limit: 50,
        search: 'roadmap',
        searchIn: 'title',
      }).success).toBe(true)
      expect(schema.safeParse({ projectId: 'proj1', pinnedOnly: true }).success)
        .toBe(true)
      expect(schema.safeParse({ projectId: '' }).success).toBe(false)
      expect(schema.safeParse({ projectId: 'x'.repeat(33) }).success)
        .toBe(false)
      expect(schema.safeParse({ pinnedOnly: 'yes' }).success).toBe(false)
    })

  it('passes the filters to the list and logs only flags', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes(['chats:read']) })
    const input = { projectId: 'proj1', pinnedOnly: true }
    const result = await tool.handler(input)

    expect(mocks.listMcpChats)
      .toHaveBeenCalledWith({ marker: 'db' }, 42, input, mocks.logger)
    expect(parseToolResult(result).chats[0]).toMatchObject({
      slug: SLUG,
      pinned: true,
      shared: false,
    })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: {
        result_count: 1,
        has_search: false,
        has_project_filter: true,
        pinned_only: true,
      },
    })
  })

  it('answers 404 for a foreign project', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes(['chats:read']) })

    mocks.listMcpChats.mockRejectedValue(
      Object.assign(new Error('missing'), { status: 404 }),
    )

    await expect(tool.handler({ projectId: 'foreign' }))
      .rejects.toMatchObject({ status: 404 })
  })
})
