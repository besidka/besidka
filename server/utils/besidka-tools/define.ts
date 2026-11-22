import { MCP_PRIVATE_TOOL_SCOPES } from '~~/server/utils/mcp/tool-scopes'
import type {
  BesidkaTool,
  BesidkaToolDefinition,
} from '~~/server/utils/besidka-tools/types'

export function defineBesidkaTool(
  definition: BesidkaToolDefinition,
): BesidkaTool {
  return {
    ...definition,
    mcpScope: MCP_PRIVATE_TOOL_SCOPES[definition.name],
  }
}
