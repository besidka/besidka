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
    listMcpSharedChats: vi.fn(),
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

vi.mock('~~/server/utils/mcp/private/chat-actions', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/chat-actions')
  >()

  return { ...original, listMcpSharedChats: mocks.listMcpSharedChats }
})

const SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FA1'

async function loadTool(context: Record<string, unknown>) {
  stubMcpToolGlobals(context)

  const module = await import('~~/server/mcp/tools/list-shared-chats')

  return module.default as unknown as McpToolShape
}

describe('list_shared_chats tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.listMcpSharedChats.mockReset()
    mocks.listMcpSharedChats.mockResolvedValue({
      chats: [{
        slug: SLUG,
        title: 'Roadmap',
        shareUrl: 'https://besidka.com/shared/share1',
        expiresAt: null,
        indexable: true,
        showFiles: true,
        allowBranch: false,
      }],
      nextCursor: null,
    })
  })

  registerChatToolContractTests({
    name: 'list_shared_chats',
    scope: 'chats:read',
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    descriptionIncludes: ['public share link', 'revoke_chat_shares'],
    validInput: {},
    mocks,
    domainMock: mocks.listMcpSharedChats,
    load: loadTool,
  })

  it('validates the cursor and the page size', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes(['chats:read']),
    })
    const schema = z.object(inputSchema)

    expect(schema.safeParse({}).success).toBe(true)
    expect(schema.safeParse({ limit: 50, cursor: 'abc' }).success).toBe(true)
    expect(schema.safeParse({ limit: 51 }).success).toBe(false)
    expect(schema.safeParse({ limit: 0 }).success).toBe(false)
    expect(schema.safeParse({ cursor: 'x'.repeat(301) }).success).toBe(false)
  })

  it('lists the shares with the site url for the share links', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes(['chats:read']) })
    const result = await tool.handler({ limit: 5 })

    expect(mocks.listMcpSharedChats).toHaveBeenCalledWith(
      { marker: 'db' },
      42,
      {
        limit: 5,
        siteUrl: 'https://besidka.com',
        includeShareUrl: false,
      },
    )
    expect(parseToolResult(result).chats[0]).toMatchObject({
      slug: SLUG,
      shareUrl: 'https://besidka.com/shared/share1',
    })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { result_count: 1 },
    })
  })

  it('includes the share url only for a token with chats:write', async () => {
    const tool = await loadTool({
      mcpAuth: authWithScopes(['chats:read', 'chats:write']),
    })

    await tool.handler({})

    expect(mocks.listMcpSharedChats).toHaveBeenCalledWith(
      { marker: 'db' },
      42,
      { siteUrl: 'https://besidka.com', includeShareUrl: true },
    )
  })

  it('refuses a token that only has chats:write', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes(['chats:write']) })

    await expect(tool.handler({})).rejects.toMatchObject({ status: 403 })
    expect(mocks.listMcpSharedChats).not.toHaveBeenCalled()
  })
})
