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
    revokeMcpChatShares: vi.fn(),
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

  return { ...original, revokeMcpChatShares: mocks.revokeMcpChatShares }
})

const SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FA1'
const SLUG_TWO = '01ARZ3NDEKTSV4RRFFQ69G5FA2'

async function loadTool(context: Record<string, unknown>) {
  stubMcpToolGlobals(context)

  const module = await import('~~/server/mcp/tools/revoke-chat-shares')

  return module.default as unknown as McpToolShape
}

describe('revoke_chat_shares tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.revokeMcpChatShares.mockReset()
    mocks.revokeMcpChatShares.mockResolvedValue({
      revoked: [SLUG],
      notShared: [SLUG_TWO],
    })
  })

  registerChatToolContractTests({
    name: 'revoke_chat_shares',
    scope: 'chats:write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    descriptionIncludes: ['Revoke the public share links', 'not shared'],
    validInput: { slugs: [SLUG] },
    mocks,
    domainMock: mocks.revokeMcpChatShares,
    load: loadTool,
  })

  it('accepts 1 to 90 slugs', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes(['chats:write']),
    })
    const schema = z.object(inputSchema)
    const slugs = (count: number) => {
      return Array.from({ length: count }, () => SLUG)
    }

    expect(schema.safeParse({ slugs: slugs(1) }).success).toBe(true)
    expect(schema.safeParse({ slugs: slugs(90) }).success).toBe(true)
    expect(schema.safeParse({ slugs: slugs(91) }).success).toBe(false)
    expect(schema.safeParse({ slugs: [] }).success).toBe(false)
    expect(schema.safeParse({ slugs: ['nope'] }).success).toBe(false)
  })

  it('revokes the links and reports what was not shared', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes(['chats:write']) })
    const input = { slugs: [SLUG, SLUG_TWO] }
    const result = await tool.handler(input)

    expect(mocks.revokeMcpChatShares)
      .toHaveBeenCalledWith({ marker: 'db' }, 42, input)
    expect(parseToolResult(result)).toEqual({
      revoked: [SLUG],
      notShared: [SLUG_TWO],
    })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { requested_count: 2, revoked_count: 1, not_shared_count: 1 },
    })
  })
})
