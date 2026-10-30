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
    branchMcpChat: vi.fn(),
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

  return { ...original, branchMcpChat: mocks.branchMcpChat }
})

const SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FA1'
const SLUG_TWO = '01ARZ3NDEKTSV4RRFFQ69G5FA2'

async function loadTool(context: Record<string, unknown>) {
  stubMcpToolGlobals(context)

  const module = await import('~~/server/mcp/tools/branch-chat')

  return module.default as unknown as McpToolShape
}

describe('branch_chat tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.branchMcpChat.mockReset()
    mocks.branchMcpChat.mockResolvedValue({
      slug: SLUG_TWO,
      title: 'Branch: Roadmap',
    })
  })

  registerChatToolContractTests({
    name: 'branch_chat',
    scope: 'chats:write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    descriptionIncludes: ['new chat', 'generating'],
    validInput: { slug: SLUG },
    mocks,
    domainMock: mocks.branchMcpChat,
    load: loadTool,
  })

  it('validates the slug and the optional message id', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes(['chats:write']),
    })
    const schema = z.object(inputSchema)

    expect(schema.safeParse({ slug: SLUG }).success).toBe(true)
    expect(schema.safeParse({ slug: SLUG, messageId: 'msg1' }).success)
      .toBe(true)
    expect(schema.safeParse({ slug: SLUG, messageId: '' }).success)
      .toBe(false)
    expect(schema.safeParse({ slug: 'nope' }).success).toBe(false)
  })

  it('branches the chat and returns the new slug and title', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes(['chats:write']) })
    const input = { slug: SLUG, messageId: 'msg1' }
    const result = await tool.handler(input)

    expect(mocks.branchMcpChat)
      .toHaveBeenCalledWith({ marker: 'db' }, 42, input, mocks.logger)
    expect(parseToolResult(result)).toEqual({
      slug: SLUG_TWO,
      title: 'Branch: Roadmap',
    })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: {
        chat_slug: SLUG,
        branch_slug: SLUG_TWO,
        from_message: true,
      },
    })
  })
})
