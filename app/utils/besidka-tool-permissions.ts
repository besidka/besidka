import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'
import { getToolGroupMode } from '~/utils/tool-permissions'
import type { ToolPermissionGroupMode } from '~/utils/tool-permissions'

export const BESIDKA_TOOL_PERMISSIONS_PANEL_KEY = 'besidka-tool-permissions'

export const BESIDKA_TOOL_PERMISSIONS_QUERY_VALUE = 'besidka-tool-permissions'

export const BESIDKA_TOOL_PERMISSIONS_LABS_PATH
  = `/profile/labs?panel=${BESIDKA_TOOL_PERMISSIONS_QUERY_VALUE}`

export type BesidkaToolGroupMode = ToolPermissionGroupMode

/**
 * The one mode every tool of a group shares, or "custom" when the group is
 * mixed (`getToolGroupMode`).
 */
export function getBesidkaToolGroupMode(
  modes: readonly ToolPermissionMode[],
): BesidkaToolGroupMode {
  return getToolGroupMode(modes)
}
