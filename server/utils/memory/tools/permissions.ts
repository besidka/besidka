import { eq } from 'drizzle-orm'
import { createError } from 'evlog'
import {
  MEMORY_PERMISSION_TOOL_NAMES,
  MEMORY_TOOL_DEFAULT_MODE,
  MEMORY_TOOL_PERMISSION_TITLES,
  getAllowedMemoryToolModes,
  isMemoryPermissionToolName,
  isMemoryToolModeAllowed,
} from '#shared/utils/memory-tool-permissions'
import type { MemoryPermissionToolName } from '#shared/utils/memory-tool-permissions'
import { TOOL_PERMISSION_MODES } from '#shared/utils/tool-approval-policy'
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

export type MemoryToolPermissionModes
  = Record<MemoryPermissionToolName, ToolPermissionMode>

export interface MemoryToolPermissionEntry {
  name: MemoryPermissionToolName
  title: string
  mode: ToolPermissionMode
}

function isPermissionMode(value: string): value is ToolPermissionMode {
  return (TOOL_PERMISSION_MODES as readonly string[]).includes(value)
}

function readStoredMode(
  toolName: MemoryPermissionToolName,
  stored: string,
): ToolPermissionMode {
  if (!isPermissionMode(stored)) {
    return 'blocked'
  }

  return isMemoryToolModeAllowed(toolName, stored)
    ? stored
    : MEMORY_TOOL_DEFAULT_MODE
}

/**
 * The user's mode for `memory_write` and `memory_forget`, read from the
 * `besidka_tool_permissions` rows of exactly these two tool names. No row
 * means the default, "ask". A row whose mode is not a known value reads as
 * Blocked, never as the default: an unreadable setting must not let a memory
 * tool run or even be offered. A mode the tool does not take (Always allow on
 * `memory_forget`, which cannot be undone) reads as "ask". The Besidka tool
 * loader and panel never see these names, because they resolve registry
 * names only.
 */
export async function loadMemoryToolPermissionModes(
  userId: number,
  db: DbClient = useDb(),
): Promise<MemoryToolPermissionModes> {
  const rows = await db.select({
    toolName: schema.besidkaToolPermissions.toolName,
    mode: schema.besidkaToolPermissions.mode,
  })
    .from(schema.besidkaToolPermissions)
    .where(eq(schema.besidkaToolPermissions.userId, userId))
  const modes: MemoryToolPermissionModes = {
    memory_write: MEMORY_TOOL_DEFAULT_MODE,
    memory_forget: MEMORY_TOOL_DEFAULT_MODE,
  }

  for (const row of rows) {
    if (isMemoryPermissionToolName(row.toolName)) {
      modes[row.toolName] = readStoredMode(row.toolName, row.mode)
    }
  }

  return modes
}

export async function listMemoryToolPermissions(
  userId: number,
  db: DbClient = useDb(),
): Promise<MemoryToolPermissionEntry[]> {
  const modes = await loadMemoryToolPermissionModes(userId, db)

  return MEMORY_PERMISSION_TOOL_NAMES.map((name) => {
    return {
      name,
      title: MEMORY_TOOL_PERMISSION_TITLES[name],
      mode: modes[name],
    }
  })
}

/**
 * Stores one mode for one memory tool, upserting its row. A mode the tool
 * does not take is a 400. The row lives in
 * `besidka_tool_permissions` under the native tool name, so no migration is
 * needed and the account purge and the restore reset of "allow" to "ask"
 * already cover it.
 */
export async function setMemoryToolPermission(
  userId: number,
  tool: MemoryPermissionToolName,
  mode: ToolPermissionMode,
  db: DbClient = useDb(),
): Promise<void> {
  if (!isMemoryToolModeAllowed(tool, mode)) {
    throw createError({
      message: 'Invalid permission',
      status: 400,
      why: `${MEMORY_TOOL_PERMISSION_TITLES[tool]} can only be set to `
        + getAllowedMemoryToolModes(tool).join(' or '),
      fix: 'Pick an allowed mode',
    })
  }

  await db.insert(schema.besidkaToolPermissions)
    .values({ userId, toolName: tool, mode })
    .onConflictDoUpdate({
      target: [
        schema.besidkaToolPermissions.userId,
        schema.besidkaToolPermissions.toolName,
      ],
      set: { mode, updatedAt: new Date() },
    })
}
