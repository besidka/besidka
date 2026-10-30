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
    deleteMcpChats: vi.fn(),
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

  return { ...original, deleteMcpChats: mocks.deleteMcpChats }
})

const SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FA1'
const SLUG_TWO = '01ARZ3NDEKTSV4RRFFQ69G5FA2'

async function loadTool(context: Record<string, unknown>) {
  stubMcpToolGlobals(context)

  const module = await import('~~/server/mcp/tools/delete-chats')

  return module.default as unknown as McpToolShape
}

describe('delete_chats tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.deleteMcpChats.mockReset()
    mocks.deleteMcpChats.mockResolvedValue({
      deleted: [SLUG],
      skipped: [{ slug: SLUG_TWO, reason: 'generating' }],
    })
  })

  registerChatToolContractTests({
    name: 'delete_chats',
    scope: 'data:delete',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    descriptionIncludes: ['Permanently delete', 'cannot be undone', 'skipped'],
    validInput: { slugs: [SLUG] },
    mocks,
    domainMock: mocks.deleteMcpChats,
    load: loadTool,
  })

  it('accepts 1 to 25 slugs', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes(['data:delete']),
    })
    const schema = z.object(inputSchema)
    const slugs = (count: number) => {
      return Array.from({ length: count }, () => SLUG)
    }

    expect(schema.safeParse({ slugs: slugs(1) }).success).toBe(true)
    expect(schema.safeParse({ slugs: slugs(25) }).success).toBe(true)
    expect(schema.safeParse({ slugs: slugs(26) }).success).toBe(false)
    expect(schema.safeParse({ slugs: [] }).success).toBe(false)
    expect(schema.safeParse({ slugs: ['nope'] }).success).toBe(false)
  })

  it('deletes the chats and reports the skipped ones', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes(['data:delete']) })
    const input = { slugs: [SLUG, SLUG_TWO] }
    const result = await tool.handler(input)

    expect(mocks.deleteMcpChats)
      .toHaveBeenCalledWith({ marker: 'db' }, 42, input, mocks.logger)
    expect(parseToolResult(result)).toEqual({
      deleted: [SLUG],
      skipped: [{ slug: SLUG_TWO, reason: 'generating' }],
    })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { requested_count: 2, deleted_count: 1, skipped_count: 1 },
    })
  })
})
