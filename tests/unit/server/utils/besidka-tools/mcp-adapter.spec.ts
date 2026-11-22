import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'
import { MCP_PRIVATE_TOOL_SCOPES } from '~~/server/utils/mcp/tool-scopes'

const mocks = vi.hoisted(() => {
  return {
    withMcpPrivateTool: vi.fn(),
  }
})

vi.mock('~~/server/utils/mcp/private-tool', () => {
  return { withMcpPrivateTool: mocks.withMcpPrivateTool }
})

const CONTEXT = {
  userId: 42,
  clientId: 'client-abc',
  scopes: ['projects:write'],
  db: { marker: 'db' },
  logger: { set: vi.fn() },
  log: vi.fn(),
}

describe('toMcpToolDefinition', () => {
  const handler = vi.fn()

  beforeEach(() => {
    handler.mockReset().mockResolvedValue({ ok: true })
    mocks.withMcpPrivateTool.mockReset().mockImplementation(
      (_name: string, wrapped: unknown) => {
        return wrapped
      },
    )
  })

  it('passes the entry through and wraps the handler under its own name',
    async () => {
      const inputSchema = { name: z.string() }
      const tool = defineBesidkaTool({
        name: 'create_project',
        title: 'Create a project',
        description: 'Create a project.',
        inputSchema,
        annotations: { readOnlyHint: false, destructiveHint: false },
        access: 'write',
        chat: { expose: true, tier: 'write' },
        chatDescription: 'Create a project.',
        handler,
      })
      const definition = toMcpToolDefinition(tool)

      expect(definition).toMatchObject({
        name: 'create_project',
        title: 'Create a project',
        description: 'Create a project.',
        annotations: { readOnlyHint: false, destructiveHint: false },
      })
      expect(definition.inputSchema).toBe(inputSchema)
      expect(mocks.withMcpPrivateTool).toHaveBeenCalledWith(
        'create_project',
        expect.any(Function),
      )

      const result = await (definition.handler as (
        input: unknown,
        context: unknown,
      ) => Promise<unknown>)({ name: 'Roadmap' }, CONTEXT)

      expect(result).toEqual({ ok: true })
      expect(handler).toHaveBeenCalledWith({ name: 'Roadmap' }, CONTEXT)
    })

  it('leaves inputSchema out when the entry has none', () => {
    const tool = defineBesidkaTool({
      name: 'get_settings',
      title: 'Get my settings',
      description: 'Read settings.',
      annotations: { readOnlyHint: true },
      access: 'read',
      chat: { expose: true, tier: 'read' },
      chatDescription: 'Read settings.',
      handler,
    })

    expect('inputSchema' in toMcpToolDefinition(tool)).toBe(false)
  })

  it('takes the scope from the single scope map', () => {
    const tool = defineBesidkaTool({
      name: 'share_artifact',
      title: 'Share',
      description: 'Share.',
      annotations: { readOnlyHint: false },
      access: 'write',
      chat: { excluded: 'test' },
      handler,
    })

    expect(tool.mcpScope).toBe(MCP_PRIVATE_TOOL_SCOPES.share_artifact)
    expect(tool.mcpScope).toBe('artifacts:share')
  })
})
