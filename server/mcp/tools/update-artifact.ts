import { updateArtifactBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-artifact'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(updateArtifactBesidkaTool),
)
