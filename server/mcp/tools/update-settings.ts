import { updateSettingsBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-settings'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(updateSettingsBesidkaTool),
)
