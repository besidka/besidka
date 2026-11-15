import { deleteConnectorsBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-connectors'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(deleteConnectorsBesidkaTool),
)
