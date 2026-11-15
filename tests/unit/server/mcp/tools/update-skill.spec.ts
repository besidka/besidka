import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createError } from 'evlog'

const mocks = vi.hoisted(() => {
  return {
    logger: { set: vi.fn(), error: vi.fn() },
    enforceMcpToolRateLimit: vi.fn(),
    requireMcpLegalConsent: vi.fn(),
    domain: vi.fn(),
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

vi.mock('~~/server/utils/mcp/private/skill-context', () => {
  return {
    buildMcpSkillContext: () => ({ marker: 'skill-context' }),
  }
})

vi.mock('~~/server/utils/mcp/private/skills', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/skills')
  >()

  return { ...original, updateMcpSkill: mocks.domain }
})

const SCOPE = 'skills:write'
const AUTH = {
  userId: 42,
  clientId: 'client-abc',
  scopes: [SCOPE],
}
const VALID_INPUT = { id: 'skl1', baseVersion: 1, changes: [{ op: 'put', path: 'a.md', content: 'x' }] }

async function loadTool(context: Record<string, unknown>) {
  vi.resetModules()
  vi.stubGlobal('defineMcpTool', (definition: unknown) => {
    return definition
  })
  vi.stubGlobal('useEvent', () => {
    return { context }
  })
  vi.stubGlobal('useDb', () => {
    return { marker: 'db' }
  })

  const module = await import('~~/server/mcp/tools/update-skill')

  return module.default as unknown as {
    name: string
    description: string
    inputSchema: z.ZodRawShape
    annotations: Record<string, boolean>
    handler: (input: Record<string, unknown>) => Promise<{
      content: Array<{ type: string, text: string }>
    }>
  }
}

describe('update_skill tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.domain.mockReset()
    mocks.domain.mockResolvedValue({ id: 'skl1', name: 'review-pr', unchanged: false })
  })

  it('declares the documented annotations and description', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('update_skill')
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    })
    expect(tool.description)
      .toMatch(/Requires signing in \(skills:write\)\.$/)
    expect(tool.description).toContain('rename_skill')
    expect(tool.description).toContain('pending version')
    expect(tool.description).toContain('The skill is saved disabled. The user must review and enable it in Besidka at')
  })

  it('validates its input', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema)

    expect(schema.safeParse({ id: 'skl1', baseVersion: 1, changes: [{ op: 'put', path: 'a.md', content: 'x' }] }).success).toBe(true)
    expect(schema.safeParse({ id: 'skl1', baseVersion: 2, changes: [{ op: 'rename', from: 'a.md', to: 'b.md' }, { op: 'delete', path: 'c.md' }] }).success).toBe(true)
    expect(schema.safeParse({ id: 'skl1', baseVersion: 0, changes: [{ op: 'delete', path: 'a.md' }] }).success).toBe(false)
    expect(schema.safeParse({ id: 'skl1', baseVersion: 1, changes: [] }).success).toBe(false)
    expect(schema.safeParse({ id: 'skl1', baseVersion: 1, changes: Array.from({ length: 51 }, () => ({ op: 'delete', path: 'a.md' })) }).success).toBe(false)
    expect(schema.safeParse({ id: 'skl1', baseVersion: 1, changes: [{ op: 'copy', path: 'a.md' }] }).success).toBe(false)
    expect(schema.safeParse({ id: 'skl1', baseVersion: 1, changes: [{ op: 'put', path: 'a.md', content: 'x'.repeat(200_001) }] }).success).toBe(false)
    expect(Object.keys(inputSchema).sort())
      .toEqual(['baseVersion', 'changes', 'id'])
  })

  it('runs the domain function for the token user and logs ids only',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })
      const result = await tool.handler(VALID_INPUT)
      const payload = JSON.parse(result.content[0]!.text)

      expect(mocks.domain).toHaveBeenCalledWith(
        { marker: 'skill-context' },
        { id: 'skl1', baseVersion: 1, changes: [{ op: 'put', path: 'a.md', content: 'x' }] },
      )
      expect(payload).toEqual({ id: 'skl1', name: 'review-pr', unchanged: false })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: {
          user_id: 42,
          client_id: 'client-abc',
          tool_kind: 'write',
        },
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: { skill_id: 'skl1', change_count: 1 },
      })
      expect(mocks.enforceMcpToolRateLimit)
        .toHaveBeenCalledWith(42, 'update_skill')
      expect(mocks.requireMcpLegalConsent)
        .toHaveBeenCalledWith(42, 'https://besidka.com', expect.anything())
    })

  it('does nothing for a token without skills:write', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['skills:read'] },
    })

    await expect(tool.handler(VALID_INPUT)).rejects.toMatchObject({
      status: 403,
    })
    expect(mocks.domain).not.toHaveBeenCalled()
  })

  it('does nothing without a verified token', async () => {
    const tool = await loadTool({})

    await expect(tool.handler(VALID_INPUT)).rejects.toMatchObject({
      status: 401,
    })
    expect(mocks.domain).not.toHaveBeenCalled()
  })

  it('does nothing without consent', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.requireMcpLegalConsent.mockRejectedValue(createError({
      status: 403,
      message: 'Open https://besidka.com and accept the terms.',
    }))

    await expect(tool.handler(VALID_INPUT)).rejects.toMatchObject({
      status: 403,
    })
    expect(mocks.domain).not.toHaveBeenCalled()
  })

  it('does nothing when the call limit is exceeded', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.enforceMcpToolRateLimit.mockRejectedValue(createError({
      status: 429,
      message: 'Too many Besidka tool calls.',
    }))

    await expect(tool.handler(VALID_INPUT)).rejects.toMatchObject({
      status: 429,
    })
    expect(mocks.domain).not.toHaveBeenCalled()
  })
})
