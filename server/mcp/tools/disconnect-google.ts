import { disconnectGoogleBesidkaTool } from '~~/server/utils/besidka-tools/tools/disconnect-google'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(disconnectGoogleBesidkaTool),
)
