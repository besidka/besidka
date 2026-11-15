import { addConnectorBesidkaTool } from '~~/server/utils/besidka-tools/tools/add-connector'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(addConnectorBesidkaTool),
)
