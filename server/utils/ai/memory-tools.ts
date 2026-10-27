import {
  MEMORY_FORGET_TOOL_NAME,
  MEMORY_LIST_TOOL_NAME,
  MEMORY_READ_TOOL_NAME,
  MEMORY_WRITE_TOOL_NAME,
} from '~~/server/utils/memory/tools/memory-constants'

export const MEMORY_TOOL_NAMES: readonly string[] = [
  MEMORY_LIST_TOOL_NAME,
  MEMORY_READ_TOOL_NAME,
  MEMORY_WRITE_TOOL_NAME,
  MEMORY_FORGET_TOOL_NAME,
]

export function isMemoryToolName(toolName: string): boolean {
  return MEMORY_TOOL_NAMES.includes(toolName)
}
