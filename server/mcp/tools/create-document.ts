import { createDocumentBesidkaTool } from '~~/server/utils/besidka-tools/tools/create-document'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(createDocumentBesidkaTool),
)
