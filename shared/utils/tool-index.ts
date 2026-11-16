export const TOOL_INDEX_LOAD_TOOL_NAME = 'tool_index__load'

export const TOOL_INDEX_SOURCE_BESIDKA = 'besidka'

export const TOOL_INDEX_RESERVED_TOOLS = 10

export const TOOL_INDEX_RESERVED_BYTES = 12 * 1024

export const TOOL_INDEX_LOAD_NAMES_MAX = 10

export const TOOL_INDEX_DESCRIPTION_MAX = 100

export const TOOL_INDEX_TEXT_MAX_BYTES = 24 * 1024

export const TOOL_INDEX_LOAD_STEPS = 2

export const TOOL_INDEX_CLASSES = ['read', 'write', 'always-ask'] as const

export type ToolIndexClass = typeof TOOL_INDEX_CLASSES[number]

export function isToolIndexLoadToolName(toolName: string): boolean {
  return toolName === TOOL_INDEX_LOAD_TOOL_NAME
}
