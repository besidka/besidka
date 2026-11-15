import { listConnectorsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-connectors'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(listConnectorsBesidkaTool),
)
