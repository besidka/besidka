import { listFilesBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-files'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(listFilesBesidkaTool),
)
