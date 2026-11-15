import { setProjectSkillsBesidkaTool } from '~~/server/utils/besidka-tools/tools/set-project-skills'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(setProjectSkillsBesidkaTool),
)
