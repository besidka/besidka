import { eq } from 'drizzle-orm'
import { createError } from 'evlog'
import {
  BESIDKA_TOOL_DEFAULT_MODE,
  BESIDKA_TOOL_NAME_PREFIX,
  BESIDKA_TOOL_TIERS,
  getAllowedBesidkaToolModes,
  isBesidkaToolModeAllowed,
} from '#shared/utils/besidka-tool-permissions'
import type { BesidkaToolPermissionTier } from '#shared/utils/besidka-tool-permissions'
import {
  TOOL_PERMISSION_MODES,
} from '#shared/utils/tool-approval-policy'
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'
import * as schema from '~~/server/db/schema'
import {
  BESIDKA_TOOLS,
  listChatExposedBesidkaTools,
} from '~~/server/utils/besidka-tools/registry'
import type { ChatExposedBesidkaTool } from '~~/server/utils/besidka-tools/registry'

type DbClient = ReturnType<typeof useDb>

export type BesidkaToolPermissionModes = ReadonlyMap<string, ToolPermissionMode>

export type BesidkaPermissionCache
  = Map<number, Promise<BesidkaToolPermissionModes>>

export interface BesidkaToolPermissionEntry {
  name: string
  title: string
  tier: BesidkaToolPermissionTier
  mode: ToolPermissionMode
}

export type BesidkaToolPermissionTarget
  = | { tool: string }
    | { tier: BesidkaToolPermissionTier }

export function createBesidkaPermissionCache(): BesidkaPermissionCache {
  return new Map()
}

/**
 * The registry name behind a name the model sees. A tool call name arrives
 * as `besidka__<registry name>`; a bare registry name is accepted too, so the
 * routes and the chat send share one lookup.
 */
export function toBesidkaRegistryName(toolName: string): string {
  return toolName.startsWith(BESIDKA_TOOL_NAME_PREFIX)
    ? toolName.slice(BESIDKA_TOOL_NAME_PREFIX.length)
    : toolName
}

export function findExposedBesidkaTool(
  toolName: string,
): ChatExposedBesidkaTool | null {
  const registryName = toBesidkaRegistryName(toolName)

  if (!Object.hasOwn(BESIDKA_TOOLS, registryName)) {
    return null
  }

  return listChatExposedBesidkaTools().find((tool) => {
    return tool.name === registryName
  }) ?? null
}

function isPermissionMode(value: string): value is ToolPermissionMode {
  return (TOOL_PERMISSION_MODES as readonly string[]).includes(value)
}

/**
 * The mode that applies to a tool given what is stored. A stored "allow" on
 * an ask-every-time tool (a row written before the tool moved tier, or one
 * brought back by a restore) counts as "ask": that tier never runs without a
 * fresh answer.
 */
function effectiveMode(
  tier: BesidkaToolPermissionTier,
  stored: ToolPermissionMode | undefined,
): ToolPermissionMode {
  const mode = stored ?? BESIDKA_TOOL_DEFAULT_MODE

  return isBesidkaToolModeAllowed(tier, mode) ? mode : BESIDKA_TOOL_DEFAULT_MODE
}

/**
 * The stored mode of each tool that has a row. A row whose mode is not one
 * of the known values reads as Blocked, never as the default: an unreadable
 * setting must not let a tool run or even be offered.
 */
export async function loadBesidkaToolPermissionModes(
  userId: number,
  db: DbClient = useDb(),
): Promise<BesidkaToolPermissionModes> {
  const rows = await db.select({
    toolName: schema.besidkaToolPermissions.toolName,
    mode: schema.besidkaToolPermissions.mode,
  })
    .from(schema.besidkaToolPermissions)
    .where(eq(schema.besidkaToolPermissions.userId, userId))
  const modes = new Map<string, ToolPermissionMode>()

  for (const row of rows) {
    modes.set(
      row.toolName,
      isPermissionMode(row.mode) ? row.mode : 'blocked',
    )
  }

  return modes
}

/**
 * Every tool the model can be given in a chat with the user's mode for it,
 * grouped by tier order and then by title. The default is "ask".
 */
export async function listBesidkaToolPermissions(
  userId: number,
  db: DbClient = useDb(),
): Promise<BesidkaToolPermissionEntry[]> {
  const modes = await loadBesidkaToolPermissionModes(userId, db)

  return listChatExposedBesidkaTools()
    .map((tool) => {
      return {
        name: tool.name,
        title: tool.title,
        tier: tool.chat.tier,
        mode: effectiveMode(tool.chat.tier, modes.get(tool.name)),
      }
    })
    .sort((first, second) => {
      return BESIDKA_TOOL_TIERS.indexOf(first.tier)
        - BESIDKA_TOOL_TIERS.indexOf(second.tier)
        || first.title.localeCompare(second.title)
    })
}

/**
 * The mode for a tool name from already loaded modes, with no I/O. A tool
 * that is not exposed to chats, or is unknown, reads as Blocked: nothing may
 * run it.
 */
export function pickBesidkaPermissionMode(
  toolName: string,
  modes: BesidkaToolPermissionModes,
): ToolPermissionMode {
  const tool = findExposedBesidkaTool(toolName)

  if (!tool) {
    return 'blocked'
  }

  return effectiveMode(tool.chat.tier, modes.get(tool.name))
}

/**
 * The effective mode of each named tool, keyed by the name as given (the
 * chat name `besidka__<name>` stays as is), from one read of the user's rows.
 */
export async function resolveBesidkaPermissionModes(
  userId: number,
  toolNames: readonly string[],
  db: DbClient = useDb(),
): Promise<Map<string, ToolPermissionMode>> {
  const stored = await loadBesidkaToolPermissionModes(userId, db)

  return new Map(toolNames.map((toolName) => {
    return [toolName, pickBesidkaPermissionMode(toolName, stored)]
  }))
}

/**
 * The user's permission mode for one Besidka tool, read from D1 once per
 * cache (pass the same cache for the whole request).
 */
export async function resolveBesidkaPermissionMode(
  userId: number,
  toolName: string,
  options: { cache?: BesidkaPermissionCache, db?: DbClient } = {},
): Promise<ToolPermissionMode> {
  if (!findExposedBesidkaTool(toolName)) {
    return 'blocked'
  }

  let pending = options.cache?.get(userId)

  if (!pending) {
    pending = loadBesidkaToolPermissionModes(userId, options.db)
    options.cache?.set(userId, pending)
  }

  try {
    return pickBesidkaPermissionMode(toolName, await pending)
  } catch (exception) {
    options.cache?.delete(userId)

    throw exception
  }
}

function invalidPermission(why: string) {
  return createError({
    message: 'Invalid permission',
    status: 400,
    why,
    fix: 'Pick a listed tool or group and an allowed mode',
  })
}

function resolveTargetTools(
  target: BesidkaToolPermissionTarget,
): ChatExposedBesidkaTool[] {
  if ('tool' in target) {
    const tool = findExposedBesidkaTool(target.tool)

    if (!tool || toBesidkaRegistryName(target.tool) !== target.tool) {
      throw invalidPermission('This tool is not available in chats')
    }

    return [tool]
  }

  return listChatExposedBesidkaTools(target.tier)
}

/**
 * Stores one mode for a tool or for every tool of a tier, upserting one row
 * per tool in a single batch. The mode must be one the tier allows: the
 * ask-every-time tier takes only Blocked and Needs approval. A tool that is
 * unknown, excluded from chats or named with the chat prefix is a 400.
 */
export async function setBesidkaToolPermissions(
  userId: number,
  target: BesidkaToolPermissionTarget,
  mode: ToolPermissionMode,
  db: DbClient = useDb(),
): Promise<number> {
  const tools = resolveTargetTools(target)
  const refused = tools.find((tool) => {
    return !isBesidkaToolModeAllowed(tool.chat.tier, mode)
  })

  if (refused) {
    const allowed = getAllowedBesidkaToolModes(refused.chat.tier).join(' or ')

    throw invalidPermission(
      `${refused.title} can only be set to ${allowed}`,
    )
  }

  if (!tools.length) {
    return 0
  }

  const statements = tools.map((tool) => {
    return db.insert(schema.besidkaToolPermissions)
      .values({ userId, toolName: tool.name, mode })
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
