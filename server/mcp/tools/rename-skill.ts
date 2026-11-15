import { renameSkillBesidkaTool } from '~~/server/utils/besidka-tools/tools/rename-skill'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(renameSkillBesidkaTool),
)
