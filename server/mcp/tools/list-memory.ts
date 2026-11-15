import { listMemoryBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-memory'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(listMemoryBesidkaTool),
)
