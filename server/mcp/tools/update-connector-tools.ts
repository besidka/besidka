import { updateConnectorToolsBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-connector-tools'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(updateConnectorToolsBesidkaTool),
)
