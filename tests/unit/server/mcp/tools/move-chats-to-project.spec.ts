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
    moveMcpChatsToProject: vi.fn(),
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

  return { ...original, moveMcpChatsToProject: mocks.moveMcpChatsToProject }
})

const SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FA1'
const SLUG_TWO = '01ARZ3NDEKTSV4RRFFQ69G5FA2'

async function loadTool(context: Record<string, unknown>) {
  stubMcpToolGlobals(context)

  const module = await import('~~/server/mcp/tools/move-chats-to-project')

  return module.default as unknown as McpToolShape
}

describe('move_chats_to_project tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.moveMcpChatsToProject.mockReset()
    mocks.moveMcpChatsToProject.mockResolvedValue({
      moved: 1,
      alreadyThere: 1,
      notFound: [SLUG_TWO],
    })
  })

  registerChatToolContractTests({
    name: 'move_chats_to_project',
    scope: 'chats:write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    descriptionIncludes: ['null projectId', 'already there'],
    validInput: { slugs: [SLUG], projectId: 'proj1' },
    mocks,
    domainMock: mocks.moveMcpChatsToProject,
    load: loadTool,
  })

  it('accepts 1 to 100 slugs and a nullable project', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes(['chats:write']),
    })
    const schema = z.object(inputSchema)
    const slugs = (count: number) => {
      return Array.from({ length: count }, () => SLUG)
    }

    expect(schema.safeParse({ slugs: slugs(1), projectId: null }).success)
      .toBe(true)
    expect(schema.safeParse({ slugs: slugs(100), projectId: 'p' }).success)
      .toBe(true)
    expect(schema.safeParse({ slugs: slugs(101), projectId: 'p' }).success)
      .toBe(false)
    expect(schema.safeParse({ slugs: [], projectId: 'p' }).success)
      .toBe(false)
    expect(schema.safeParse({ slugs: ['nope'], projectId: 'p' }).success)
      .toBe(false)
    expect(schema.safeParse({ slugs: slugs(1) }).success).toBe(false)
  })

  it('moves the chats and reports the counts', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes(['chats:write']) })
    const input = { slugs: [SLUG, SLUG_TWO], projectId: 'proj1' }
    const result = await tool.handler(input)

    expect(mocks.moveMcpChatsToProject)
      .toHaveBeenCalledWith({ marker: 'db' }, 42, input)
    expect(parseToolResult(result)).toEqual({
      moved: 1,
      alreadyThere: 1,
      notFound: [SLUG_TWO],
    })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: {
        requested_count: 2,
        moved_count: 1,
        already_there_count: 1,
        not_found_count: 1,
      },
    })
  })
})
