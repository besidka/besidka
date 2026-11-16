export const TOOL_INDEX_LOAD_TOOL_NAME = 'tool_index__load'

export const TOOL_INDEX_USE_CONNECTOR_TOOL_NAME = 'use_connector'

export const TOOL_INDEX_CATALOG_STEPS = 1

export const TOOL_INDEX_SOURCE_BESIDKA = 'besidka'

export const TOOL_INDEX_RESERVED_TOOLS = 10

export const TOOL_INDEX_RESERVED_BYTES = 12 * 1024

export const TOOL_INDEX_LOAD_NAMES_MAX = 10

export const TOOL_INDEX_DESCRIPTION_MAX = 100

export const TOOL_INDEX_TEXT_MAX_BYTES = 24 * 1024

export const TOOL_INDEX_TOTAL_MAX_BYTES = 40 * 1024

export const TOOL_INDEX_LOAD_STEPS = 2

export const TOOL_INDEX_CLASSES = ['read', 'write', 'always-ask'] as const

export type ToolIndexClass = typeof TOOL_INDEX_CLASSES[number]

/**
 * Whether a tool is one of the tool index's own loaders (`tool_index__load`
 * and `use_connector`): they run no action and need no approval.
 */
export function isToolIndexLoadToolName(toolName: string): boolean {
  return toolName === TOOL_INDEX_LOAD_TOOL_NAME
    || toolName === TOOL_INDEX_USE_CONNECTOR_TOOL_NAME
}
