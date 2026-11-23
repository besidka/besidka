import { and, eq, inArray } from 'drizzle-orm'
import { createError } from 'evlog'
import { GOOGLE_TOOL_NAME_PREFIX } from '#shared/utils/google-tool-approvals'
import type { GoogleToolKind } from '#shared/utils/google-tool-approvals'
import {
  GOOGLE_TOOL_CATALOG,
  GOOGLE_TOOL_DEFAULT_MODE,
  isGoogleToolAlwaysAllowable,
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
    | { service: GoogleService, kind: GoogleToolKind }

/**
 * The stored mode of each Google tool that has a row, from one read of the
 * user's `besidka_tool_permissions` rows, keeping only names that start with
 * `google__`. A stored "allow" reads as "allow" only for a tool that can be
 * always allowed and as "ask" for any other; an unknown value reads as
 * "blocked", because an unreadable setting must not let a tool run or be
 * offered. A tool with no row is not in the map and means "ask".
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
      modes.set(
        row.toolName,
        readGoogleToolPermissionMode(row.toolName, row.mode),
      )
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
    fix: 'Pick a listed Google tool or service and a mode it offers',
  })
}

/**
 * Splits the tools a request names into those that take the mode and those
 * that stay as they are. Only Always allow narrows: a tool the app cannot
 * always allow (`isGoogleToolAlwaysAllowable`) is left unchanged, while
 * Blocked and Needs approval apply to every tool.
 */
export function partitionGoogleToolsForMode(
  tools: readonly GoogleToolCatalogEntry[],
  mode: GoogleToolPermissionMode,
): { applied: GoogleToolCatalogEntry[], unchanged: GoogleToolCatalogEntry[] } {
  if (mode !== 'allow') {
    return { applied: [...tools], unchanged: [] }
  }

  return {
    applied: tools.filter(tool => isGoogleToolAlwaysAllowable(tool)),
    unchanged: tools.filter(tool => !isGoogleToolAlwaysAllowable(tool)),
  }
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
      && (!('kind' in target) || tool.kind === target.kind)
  })
}

/**
 * Stores one mode for the given Google tools. "ask" is the default and needs
 * no storage, so it deletes any row; "blocked" and "allow" upsert one row
 * per tool, in a single batch. The tools must come from
 * `resolveGoogleTargetTools` (further narrowed to what the user may reach),
 * so a name that is not in the catalog is never written; "allow" is also
 * narrowed here to the tools that can be always allowed, so no caller can
 * store it for another. Returns how many tools were set.
 */
export async function setGoogleToolPermissions(
  userId: number,
  tools: readonly GoogleToolCatalogEntry[],
  mode: GoogleToolPermissionMode,
  db: DbClient = useDb(),
): Promise<number> {
  const storable = partitionGoogleToolsForMode(tools, mode).applied

  if (!storable.length) {
    return 0
  }

  const toolNames = storable.map(tool => tool.name)

  if (mode === 'ask') {
    await db.delete(schema.besidkaToolPermissions)
      .where(and(
        eq(schema.besidkaToolPermissions.userId, userId),
        inArray(schema.besidkaToolPermissions.toolName, toolNames),
      ))

    return storable.length
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

  return storable.length
}
