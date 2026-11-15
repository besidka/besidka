import { getConnectorBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-connector'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(getConnectorBesidkaTool),
)
