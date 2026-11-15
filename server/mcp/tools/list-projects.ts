import { listProjectsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-projects'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(listProjectsBesidkaTool),
)
