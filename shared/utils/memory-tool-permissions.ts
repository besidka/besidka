import { TOOL_APPROVAL_MEMORY_WRITE_TOOL_NAMES } from '#shared/utils/tool-approval-policy'
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'

export const MEMORY_PERMISSION_TOOL_NAMES
  = TOOL_APPROVAL_MEMORY_WRITE_TOOL_NAMES

export type MemoryPermissionToolName
  = typeof MEMORY_PERMISSION_TOOL_NAMES[number]

export const MEMORY_TOOL_DEFAULT_MODE: ToolPermissionMode = 'ask'

export const MEMORY_TOOL_PERMISSION_WRITES_PER_MINUTE = 60

export const MEMORY_TOOL_PERMISSION_TITLES: Record<
  MemoryPermissionToolName,
  string
> = {
  memory_write: 'Save to memory',
  memory_forget: 'Forget from memory',
}

export const MEMORY_TOOL_PERMISSION_DESCRIPTIONS: Record<
  MemoryPermissionToolName,
  string
> = {
  memory_write: 'Add or update an entry when you ask the model to remember '
    + 'something, in account memory or in a project.',
  memory_forget: 'Remove an entry when you ask the model to forget '
    + 'something, in account memory or in a project.',
}

export const MEMORY_TOOL_PERMISSION_READ_NOTE = 'Reading memory never asks.'

export const MEMORY_TOOL_ALWAYS_ALLOW_WARNING = 'Always allow lets the model '
  + 'save to and remove from your memory without asking, also in a message '
  + 'that searched the web or read files. Text from those sources can shape '
  + 'what gets saved when you ask for a save, and saved memory is sent to '
  + 'the model in later chats. The sensitive-topic check and the never-store '
  + 'list still run on every save.'

export function isMemoryPermissionToolName(
  toolName: string,
): toolName is MemoryPermissionToolName {
  return (MEMORY_PERMISSION_TOOL_NAMES as readonly string[]).includes(toolName)
}
