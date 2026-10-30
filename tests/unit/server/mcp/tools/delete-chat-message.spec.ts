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
    deleteMcpChatMessage: vi.fn(),
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

  return { ...original, deleteMcpChatMessage: mocks.deleteMcpChatMessage }
})

const SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FA1'

async function loadTool(context: Record<string, unknown>) {
  stubMcpToolGlobals(context)

  const module = await import('~~/server/mcp/tools/delete-chat-message')

  return module.default as unknown as McpToolShape
}

describe('delete_chat_message tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.deleteMcpChatMessage.mockReset()
    mocks.deleteMcpChatMessage.mockResolvedValue({
      slug: SLUG,
      messageId: 'msg1',
      deleted: true,
    })
  })

  registerChatToolContractTests({
    name: 'delete_chat_message',
    scope: 'data:delete',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    descriptionIncludes: ['only message', 'generating'],
    validInput: { slug: SLUG, messageId: 'msg1' },
    mocks,
    domainMock: mocks.deleteMcpChatMessage,
    load: loadTool,
  })

  it('validates the slug and the message id', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes(['data:delete']),
    })
    const schema = z.object(inputSchema)

    expect(schema.safeParse({ slug: SLUG, messageId: 'msg1' }).success)
      .toBe(true)
    expect(schema.safeParse({ slug: SLUG, messageId: '' }).success)
      .toBe(false)
    expect(schema.safeParse({ slug: SLUG, messageId: 'x'.repeat(65) }).success)
      .toBe(false)
    expect(schema.safeParse({ slug: 'nope', messageId: 'msg1' }).success)
      .toBe(false)
    expect(schema.safeParse({ slug: SLUG }).success).toBe(false)
  })

  it('deletes the message of the token user\'s chat', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes(['data:delete']) })
    const input = { slug: SLUG, messageId: 'msg1' }
    const result = await tool.handler(input)

    expect(mocks.deleteMcpChatMessage)
      .toHaveBeenCalledWith({ marker: 'db' }, 42, input, mocks.logger)
    expect(parseToolResult(result)).toEqual({
      slug: SLUG,
      messageId: 'msg1',
      deleted: true,
    })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { chat_slug: SLUG, message_id: 'msg1' },
    })
  })

  it('passes the conflict of a generating chat through', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes(['data:delete']) })

    mocks.deleteMcpChatMessage.mockRejectedValue(
      Object.assign(new Error('generating'), { status: 409 }),
    )

    await expect(tool.handler({ slug: SLUG, messageId: 'msg1' }))
      .rejects.toMatchObject({ status: 409 })
  })
})
