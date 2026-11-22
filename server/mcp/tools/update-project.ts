import { updateProjectBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-project'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(updateProjectBesidkaTool),
)
