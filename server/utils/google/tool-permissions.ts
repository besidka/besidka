import { and, eq, inArray } from 'drizzle-orm'
import { createError } from 'evlog'
import { GOOGLE_TOOL_NAME_PREFIX } from '#shared/utils/google-tool-approvals'
import {
  GOOGLE_TOOL_CATALOG,
  GOOGLE_TOOL_DEFAULT_MODE,
  readGoogleToolPermissionMode,
} from '#shared/utils/google-tool-catalog'
import type {
  GoogleService,
  GoogleToolCatalogEntry,
  GoogleToolPermissionMode,
} from '#shared/utils/google-tool-catalog'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

export type GoogleToolPermissionModes
  = ReadonlyMap<string, GoogleToolPermissionMode>

export type GoogleToolPermissionTarget
  = | { tool: string }
    | { service: GoogleService }

/**
 * The stored mode of each Google tool that has a row, from one read of the
 * user's `besidka_tool_permissions` rows, keeping only names that start with
 * `google__`. A stored "allow" or an unknown value reads as "blocked": the
 * Google tools have no Always allow, and an unreadable setting must not let
 * a tool run or be offered. A tool with no row is not in the map and means
 * "ask".
 */
export async function loadGoogleToolPermissionModes(
  userId: number,
  db: DbClient = useDb(),
): Promise<Map<string, GoogleToolPermissionMode>> {
  const rows = await db.select({
    toolName: schema.besidkaToolPermissions.toolName,
    mode: schema.besidkaToolPermissions.mode,
  })
    .from(schema.besidkaToolPermissions)
    .where(eq(schema.besidkaToolPermissions.userId, userId))
  const modes = new Map<string, GoogleToolPermissionMode>()

  for (const row of rows) {
    if (row.toolName.startsWith(GOOGLE_TOOL_NAME_PREFIX)) {
      modes.set(row.toolName, readGoogleToolPermissionMode(row.mode))
    }
  }

  return modes
}

/**
 * The effective mode of a Google tool from already loaded modes, with no
 * I/O: the stored one, else "ask".
 */
export function pickGoogleToolPermissionMode(
  toolName: string,
  modes: GoogleToolPermissionModes,
): GoogleToolPermissionMode {
  return modes.get(toolName) ?? GOOGLE_TOOL_DEFAULT_MODE
}

function invalidPermission(why: string) {
  return createError({
    message: 'Invalid permission',
    status: 400,
    why,
    fix: 'Pick a listed Google tool or service and Blocked or Needs approval',
  })
}

export function resolveGoogleTargetTools(
  target: GoogleToolPermissionTarget,
): GoogleToolCatalogEntry[] {
  if ('tool' in target) {
    const tool = GOOGLE_TOOL_CATALOG.find((candidate) => {
      return candidate.name === target.tool
    })

    if (!tool) {
      throw invalidPermission('This is not a Google tool')
    }

    return [tool]
  }

  return GOOGLE_TOOL_CATALOG.filter((tool) => {
    return tool.service === target.service
  })
}

/**
 * Stores one mode for the given Google tools. "ask" is the default and needs
 * no storage, so it deletes any row; "blocked" upserts one row per tool, in
 * a single batch. The tools must come from `resolveGoogleTargetTools`
 * (further narrowed to what the user may reach), so a name that is not in
 * the catalog is never written. Returns how many tools were set.
 */
export async function setGoogleToolPermissions(
  userId: number,
  tools: readonly GoogleToolCatalogEntry[],
  mode: GoogleToolPermissionMode,
  db: DbClient = useDb(),
): Promise<number> {
  if (!tools.length) {
    return 0
  }

  const toolNames = tools.map(tool => tool.name)

  if (mode === 'ask') {
    await db.delete(schema.besidkaToolPermissions)
      .where(and(
        eq(schema.besidkaToolPermissions.userId, userId),
        inArray(schema.besidkaToolPermissions.toolName, toolNames),
      ))

    return tools.length
  }

  const statements = toolNames.map((toolName) => {
    return db.insert(schema.besidkaToolPermissions)
      .values({ userId, toolName, mode })
      .onConflictDoUpdate({
        target: [
          schema.besidkaToolPermissions.userId,
          schema.besidkaToolPermissions.toolName,
        ],
        set: { mode, updatedAt: new Date() },
      })
  })

  await db.batch(statements as [typeof statements[number]])

  return tools.length
}
