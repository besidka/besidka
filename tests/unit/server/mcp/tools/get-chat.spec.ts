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
    getMcpChat: vi.fn(),
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

  return { ...original, getMcpChat: mocks.getMcpChat }
})

const SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FA1'

async function loadTool(context: Record<string, unknown>) {
  stubMcpToolGlobals(context)

  const module = await import('~~/server/mcp/tools/get-chat')

  return module.default as unknown as McpToolShape
}

describe('get_chat tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.getMcpChat.mockReset()
    mocks.getMcpChat.mockResolvedValue({
      slug: SLUG,
      pinned: true,
      memoryExcluded: false,
      projectName: 'Vaimo',
      share: null,
      truncated: false,
      messages: [],
    })
  })

  registerChatToolContractTests({
    name: 'get_chat',
    scope: 'chats:read',
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    descriptionIncludes: ['pinned', 'share link', 'truncated'],
    validInput: { slug: SLUG },
    mocks,
    domainMock: mocks.getMcpChat,
    load: loadTool,
  })

  it('passes the site url so the share link can be built', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes(['chats:read']) })
    const result = await tool.handler({ slug: SLUG, maxMessages: 10 })

    expect(mocks.getMcpChat).toHaveBeenCalledWith({ marker: 'db' }, 42, {
      slug: SLUG,
      maxMessages: 10,
      siteUrl: 'https://besidka.com',
      includeShareUrl: false,
    })
    expect(parseToolResult(result)).toMatchObject({
      pinned: true,
      memoryExcluded: false,
      projectName: 'Vaimo',
      share: null,
    })
  })

  it('includes the share url only for a token with chats:write', async () => {
    const tool = await loadTool({
      mcpAuth: authWithScopes(['chats:read', 'chats:write']),
    })

    await tool.handler({ slug: SLUG })

    expect(mocks.getMcpChat).toHaveBeenCalledWith({ marker: 'db' }, 42, {
      slug: SLUG,
      siteUrl: 'https://besidka.com',
      includeShareUrl: true,
    })
  })

  it('validates the slug and the message window', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes(['chats:read']),
    })
    const schema = z.object(inputSchema)

    expect(schema.safeParse({ slug: SLUG, maxMessages: 200 }).success)
      .toBe(true)
    expect(schema.safeParse({ slug: SLUG, maxMessages: 201 }).success)
      .toBe(false)
    expect(schema.safeParse({ slug: 'nope' }).success).toBe(false)
  })
})
