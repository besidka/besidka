import { renameFileBesidkaTool } from '~~/server/utils/besidka-tools/tools/rename-file'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(renameFileBesidkaTool),
)
