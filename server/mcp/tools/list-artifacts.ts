import { listArtifactsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-artifacts'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(listArtifactsBesidkaTool),
)
