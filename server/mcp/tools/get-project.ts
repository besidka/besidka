import { getProjectBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-project'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(getProjectBesidkaTool),
)
