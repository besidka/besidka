import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'
import type { BesidkaTool } from '~~/server/utils/besidka-tools/types'

/**
 * Builds the `defineMcpTool` definition of a Besidka tool. Name, title,
 * description, schema and annotations pass through untouched, so the MCP
 * surface snapshot only changes when a tool entry changes.
 */
export function toMcpToolDefinition(tool: BesidkaTool) {
  const { inputSchema } = tool

  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    ...(inputSchema ? { inputSchema } : {}),
    annotations: tool.annotations,
    handler: withMcpPrivateTool(
      tool.name,
      async (input: unknown, context) => {
        return await tool.handler(input as never, context)
      },
    ),
  }
}
