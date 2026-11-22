import { listMyFeaturesBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-my-features'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(listMyFeaturesBesidkaTool),
)
