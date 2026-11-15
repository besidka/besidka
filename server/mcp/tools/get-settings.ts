import { getSettingsBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-settings'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(getSettingsBesidkaTool),
)
