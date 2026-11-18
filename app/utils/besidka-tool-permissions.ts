import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'
import { getToolGroupMode } from '~/utils/tool-permissions'
import type { ToolPermissionGroupMode } from '~/utils/tool-permissions'

export const BESIDKA_TOOL_PERMISSIONS_PANEL_KEY = 'besidka-tool-permissions'

export const BESIDKA_TOOL_PERMISSIONS_QUERY_VALUE = 'besidka-tool-permissions'

export const BESIDKA_TOOL_PERMISSIONS_LABS_PATH
  = `/profile/labs?panel=${BESIDKA_TOOL_PERMISSIONS_QUERY_VALUE}`

export const BESIDKA_TOOL_PERMISSIONS_CONNECTORS_PATH
  = `/chats/connectors?panel=${BESIDKA_TOOL_PERMISSIONS_QUERY_VALUE}`

/**
 * Where the tool permissions open. The Connectors page owns the Besidka row;
 * an account without the `connectors` flag has no such page, so Labs keeps
 * the panel for it.
 */
export function getBesidkaToolPermissionsPath(
  isConnectorsActive: boolean,
): string {
  return isConnectorsActive
    ? BESIDKA_TOOL_PERMISSIONS_CONNECTORS_PATH
    : BESIDKA_TOOL_PERMISSIONS_LABS_PATH
}

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
