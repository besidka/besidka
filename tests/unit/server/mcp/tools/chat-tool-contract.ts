import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createError } from 'evlog'
import { isMcpWriteScope } from '#shared/utils/mcp-oauth-scopes'

export interface McpToolShape {
  name: string
  description: string
  inputSchema: z.ZodRawShape
  annotations: Record<string, boolean>
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: string, text: string }>
  }>
}

export interface ChatToolMocks {
  logger: { set: ReturnType<typeof vi.fn> }
  enforceMcpToolRateLimit: ReturnType<typeof vi.fn>
  requireMcpLegalConsent: ReturnType<typeof vi.fn>
}

export interface ChatToolContract {
  name: string
  scope: 'chats:read' | 'chats:write' | 'data:delete'
  annotations: Record<string, boolean>
  descriptionIncludes: string[]
  validInput: Record<string, unknown>
  mocks: ChatToolMocks
  domainMock: ReturnType<typeof vi.fn>
  load: (context: Record<string, unknown>) => Promise<McpToolShape>
}

export const CHAT_TOOL_AUTH = {
  userId: 42,
  clientId: 'client-abc',
}

export function authWithScopes(scopes: string[]) {
  return { ...CHAT_TOOL_AUTH, scopes }
}

export function stubMcpToolGlobals(context: Record<string, unknown>) {
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
}

export function parseToolResult(result: {
  content: Array<{ type: string, text: string }>
}) {
  return JSON.parse(result.content[0]!.text)
}

export function registerChatToolContractTests(contract: ChatToolContract) {
  const auth = authWithScopes([contract.scope])
  const isWrite = isMcpWriteScope(contract.scope)

  it('declares its annotations and the documented description', async () => {
    const tool = await contract.load({ mcpAuth: auth })

    expect(tool.name).toBe(contract.name)
    expect(tool.annotations).toEqual(contract.annotations)
    expect(tool.description).toContain(
      `Requires signing in (${contract.scope}).`,
    )

    for (const fragment of contract.descriptionIncludes) {
      expect(tool.description).toContain(fragment)
    }
  })

  it('logs the token user and the tool kind', async () => {
    const tool = await contract.load({ mcpAuth: auth })

    await tool.handler(contract.validInput)

    expect(contract.mocks.logger.set).toHaveBeenCalledWith({
      mcp: {
        user_id: 42,
        client_id: 'client-abc',
        tool_kind: isWrite ? 'write' : 'read',
      },
    })
    expect(contract.mocks.enforceMcpToolRateLimit)
      .toHaveBeenCalledWith(42, contract.name)
    expect(contract.mocks.requireMcpLegalConsent)
      .toHaveBeenCalledWith(42, 'https://besidka.com', expect.anything())
  })

  it(`refuses a token without ${contract.scope}`, async () => {
    const tool = await contract.load({
      mcpAuth: authWithScopes(['projects:read']),
    })

    await expect(tool.handler(contract.validInput))
      .rejects.toMatchObject({ status: 403 })
    expect(contract.domainMock).not.toHaveBeenCalled()
  })

  it('refuses a call without a verified token', async () => {
    const tool = await contract.load({})

    await expect(tool.handler(contract.validInput))
      .rejects.toMatchObject({ status: 401 })
    expect(contract.domainMock).not.toHaveBeenCalled()
  })

  it('does no work without consent or past the call limit', async () => {
    const tool = await contract.load({ mcpAuth: auth })

    contract.mocks.requireMcpLegalConsent.mockRejectedValueOnce(createError({
      status: 403,
      message: 'Open https://besidka.com and accept the terms.',
    }))

    await expect(tool.handler(contract.validInput))
      .rejects.toMatchObject({ status: 403 })

    contract.mocks.enforceMcpToolRateLimit.mockRejectedValueOnce(createError({
      status: 429,
      message: 'Too many Besidka tool calls.',
    }))

    await expect(tool.handler(contract.validInput))
      .rejects.toMatchObject({ status: 429 })
    expect(contract.domainMock).not.toHaveBeenCalled()
  })
}
