import { listArtifactSharesBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-artifact-shares'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(listArtifactSharesBesidkaTool),
)
