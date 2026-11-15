import { deleteProjectBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-project'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(deleteProjectBesidkaTool),
)
