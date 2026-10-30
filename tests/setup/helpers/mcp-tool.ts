import { vi } from 'vitest'
import type { z } from 'zod'

export interface LoadedMcpTool {
  name: string
  description: string
  inputSchema?: z.ZodRawShape
  annotations: Record<string, boolean>
  handler: (input?: unknown) => Promise<{
    content: Array<{ type: string, text: string }>
  }>
}

export interface McpToolAuth {
  userId: number
  clientId: string
  scopes: string[]
}

export const TEST_MCP_AUTH: McpToolAuth = {
  userId: 42,
  clientId: 'client-abc',
  scopes: [],
}

export async function loadMcpTool(
  importTool: () => Promise<{ default: unknown }>,
  context: Record<string, unknown>,
): Promise<LoadedMcpTool> {
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

  const module = await importTool()

  return module.default as LoadedMcpTool
}

export function parseToolPayload(result: {
  content: Array<{ type: string, text: string }>
}) {
  return JSON.parse(result.content[0]!.text)
}
