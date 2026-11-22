import { listGoogleConnectionsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-google-connections'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(listGoogleConnectionsBesidkaTool),
)
