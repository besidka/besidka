import { deleteConnectorImagesBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-connector-images'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(deleteConnectorImagesBesidkaTool),
)
