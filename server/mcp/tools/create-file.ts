import { createFileBesidkaTool } from '~~/server/utils/besidka-tools/tools/create-file'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(createFileBesidkaTool),
)
