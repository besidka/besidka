import { listFeatureAccessBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-feature-access'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(listFeatureAccessBesidkaTool),
)
