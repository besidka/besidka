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
    updateMcpChat: vi.fn(),
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

  return { ...original, updateMcpChat: mocks.updateMcpChat }
})

const SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FA1'

async function loadTool(context: Record<string, unknown>) {
  stubMcpToolGlobals(context)

  const module = await import('~~/server/mcp/tools/update-chat')

  return module.default as unknown as McpToolShape
}

describe('update_chat tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.updateMcpChat.mockReset()
    mocks.updateMcpChat.mockResolvedValue({
      slug: SLUG,
      title: 'Roadmap',
      pinned: true,
      memoryExcluded: false,
      projectId: null,
      projectName: null,
    })
  })

  registerChatToolContractTests({
    name: 'update_chat',
    scope: 'chats:write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    descriptionIncludes: ['rename it', 'Pass at least one', 'sets the value'],
    validInput: { slug: SLUG, title: 'Roadmap' },
    mocks,
    domainMock: mocks.updateMcpChat,
    load: loadTool,
  })

  it('validates the slug, the trimmed title and the nullable project',
    async () => {
      const { inputSchema } = await loadTool({
        mcpAuth: authWithScopes(['chats:write']),
      })
      const schema = z.object(inputSchema)

      expect(schema.parse({ slug: SLUG, title: '  Plan  ' }).title)
        .toBe('Plan')
      expect(schema.safeParse({ slug: SLUG, title: 'x'.repeat(200) }).success)
        .toBe(true)
      expect(schema.safeParse({ slug: SLUG, title: 'x'.repeat(201) }).success)
        .toBe(false)
      expect(schema.safeParse({ slug: SLUG, title: '   ' }).success)
        .toBe(false)
      expect(schema.safeParse({ slug: SLUG, projectId: null }).success)
        .toBe(true)
      expect(schema.safeParse({ slug: SLUG, pinned: 'yes' }).success)
        .toBe(false)
      expect(schema.safeParse({ slug: 'not-a-ulid', pinned: true }).success)
        .toBe(false)
      expect(schema.safeParse({ pinned: true }).success).toBe(false)
    })

  it('updates the chat of the token user and returns its state',
    async () => {
      const tool = await loadTool({
        mcpAuth: authWithScopes(['chats:write']),
      })
      const input = { slug: SLUG, pinned: true, projectId: null }
      const result = await tool.handler(input)

      expect(mocks.updateMcpChat).toHaveBeenCalledWith(
        { marker: 'db' },
        42,
        input,
        mocks.logger,
      )
      expect(parseToolResult(result)).toEqual({
        slug: SLUG,
        title: 'Roadmap',
        pinned: true,
        memoryExcluded: false,
        projectId: null,
        projectName: null,
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: {
          chat_slug: SLUG,
          has_title: false,
          has_pinned: true,
          has_memory_excluded: false,
          has_project: true,
        },
      })
    })

  it('passes a not found through', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes(['chats:write']) })

    mocks.updateMcpChat.mockRejectedValue(
      Object.assign(new Error('missing'), { status: 404 }),
    )

    await expect(tool.handler({ slug: SLUG, pinned: true }))
      .rejects.toMatchObject({ status: 404 })
  })
})
