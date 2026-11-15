import { listFeatureFlagsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-feature-flags'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(listFeatureFlagsBesidkaTool),
)
