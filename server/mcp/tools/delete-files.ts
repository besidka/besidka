import { deleteFilesBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-files'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(deleteFilesBesidkaTool),
)
