import { getUsageStatsBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-usage-stats'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(getUsageStatsBesidkaTool),
)
