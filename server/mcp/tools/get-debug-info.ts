import { getDebugInfoBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-debug-info'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(getDebugInfoBesidkaTool),
)
