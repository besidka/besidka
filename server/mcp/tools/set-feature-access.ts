import { setFeatureAccessBesidkaTool } from '~~/server/utils/besidka-tools/tools/set-feature-access'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(setFeatureAccessBesidkaTool),
)
