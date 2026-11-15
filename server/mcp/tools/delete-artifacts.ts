import { deleteArtifactsBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-artifacts'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(deleteArtifactsBesidkaTool),
)
