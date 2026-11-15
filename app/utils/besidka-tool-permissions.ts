import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'

export const BESIDKA_TOOL_PERMISSIONS_PANEL_KEY = 'besidka-tool-permissions'

export const BESIDKA_TOOL_PERMISSIONS_QUERY_VALUE = 'besidka-tool-permissions'

export const BESIDKA_TOOL_PERMISSIONS_LABS_PATH
  = `/profile/labs?panel=${BESIDKA_TOOL_PERMISSIONS_QUERY_VALUE}`

export type BesidkaToolGroupMode = ToolPermissionMode | 'custom'

/**
 * The one mode every tool of a group shares, or "custom" when the group is
 * mixed. An empty group has no mode to show and reads as "ask", the default.
 */
export function getBesidkaToolGroupMode(
  modes: readonly ToolPermissionMode[],
): BesidkaToolGroupMode {
  const [first] = modes

  if (first === undefined) {
    return 'ask'
  }

  return modes.every(mode => mode === first) ? first : 'custom'
}
