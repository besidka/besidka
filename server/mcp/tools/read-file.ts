import { readFileBesidkaTool } from '~~/server/utils/besidka-tools/tools/read-file'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(readFileBesidkaTool),
)
