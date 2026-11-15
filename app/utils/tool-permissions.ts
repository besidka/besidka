import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'

export type ToolPermissionGroupMode = ToolPermissionMode | 'custom'

export interface ToolPermissionItem {
  name: string
  title: string
  mode: ToolPermissionMode
  modes: readonly ToolPermissionMode[]
  unavailableHint?: string
}

export interface ToolPermissionGroup {
  id: string
  label: string
  description?: string
  isLocked?: boolean
  tools: ToolPermissionItem[]
}

export interface ToolPermissionChange {
  name: string
  mode: ToolPermissionMode
}

export const TOOL_PERMISSION_MODE_LABELS: Record<ToolPermissionMode, string> = {
  allow: 'Always allow',
  ask: 'Needs approval',
  blocked: 'Blocked',
}

export const TOOL_PERMISSION_MODE_HINTS: Record<ToolPermissionMode, string> = {
  allow: 'Always allow — runs without asking',
  ask: 'Needs approval — asks before each use',
  blocked: 'Blocked — never offered to the model',
}

export const TOOL_PERMISSION_MODE_ICONS: Record<ToolPermissionMode, string> = {
  allow: 'lucide:check',
  ask: 'lucide:hand',
  blocked: 'lucide:circle-slash',
}

export const TOOL_PERMISSION_CONTROL_ORDER: readonly ToolPermissionMode[] = [
  'allow',
  'ask',
  'blocked',
]

export const TOOL_PERMISSION_SELECT_ORDER: readonly ToolPermissionMode[] = [
  'blocked',
  'ask',
  'allow',
]

export const TOOL_PERMISSION_GROUP_COLLAPSE_AFTER = 6

/**
 * The one mode every tool of a group shares, or "custom" when the group is
 * mixed. An empty group has no mode to show and reads as "ask", the default.
 */
export function getToolGroupMode(
  modes: readonly ToolPermissionMode[],
): ToolPermissionGroupMode {
  const [first] = modes

  if (first === undefined) {
    return 'ask'
  }

  return modes.every(mode => mode === first) ? first : 'custom'
}

/**
 * The modes the group select offers: every mode at least one tool of the
 * group allows, in select order.
 */
export function getGroupSelectableModes(
  tools: readonly Pick<ToolPermissionItem, 'modes'>[],
): ToolPermissionMode[] {
  return TOOL_PERMISSION_SELECT_ORDER.filter((mode) => {
    return tools.some(tool => tool.modes.includes(mode))
  })
}

/**
 * What a group select applies: the mode for every tool of the group that
 * allows it and does not already have it. A tool that cannot take the mode
 * (Always allow on a tool that deletes or shares data) keeps its own.
 */
export function getGroupModeChanges(
  tools: readonly ToolPermissionItem[],
  mode: ToolPermissionMode,
): ToolPermissionChange[] {
  return tools
    .filter(tool => tool.modes.includes(mode) && tool.mode !== mode)
    .map(tool => ({ name: tool.name, mode }))
}
