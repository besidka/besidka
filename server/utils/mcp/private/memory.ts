import { createError } from 'evlog'
import type { MemoryCategory, MemoryEntry } from '#shared/types/memory.d'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { clearBackfillWindow } from '~~/server/utils/memory/backfill'
import {
  createMemoryEntry,
  deleteExtractedMemoryEntries,
  deleteMemoryEntry,
  listMemoryEntries,
  resetMemoryEntries,
  updateMemoryEntry,
} from '~~/server/utils/memory/entries'
import type { MemoryScopeFilter } from '~~/server/utils/memory/entries'
import { resolveMemoryJevChecker } from '~~/server/utils/memory/jev-check'
import { enforceMemoryRateLimit } from '~~/server/utils/memory/rate-limit'

type DbClient = ReturnType<typeof useDb>

export const MCP_MEMORY_COMPLIANCE_ORIGIN = 'mcp'

export const mcpMemoryScopes = ['account', 'project', 'all'] as const

export type McpMemoryScope = typeof mcpMemoryScopes[number]

export interface McpMemoryEntry {
  id: string
  projectId: string | null
  category: MemoryCategory
  title: string
  description: string
  body: string
  origin: MemoryEntry['origin']
  updatedAt: string
}

export interface McpMemoryFields {
  category: MemoryCategory
  title: string
  description: string
  body: string
}

export function toMcpMemoryEntry(entry: MemoryEntry): McpMemoryEntry {
  return {
    id: entry.id,
    projectId: entry.projectId,
    category: entry.category,
    title: entry.title,
    description: entry.description,
    body: entry.body,
    origin: entry.origin,
    updatedAt: entry.updatedAt,
  }
}

function createInvalidMemoryInputError(message: string) {
  return createError({ status: 400, message })
}

function resolveMcpMemoryScope(input: {
  scope?: McpMemoryScope
  projectId?: string
}): { scope: McpMemoryScope, filter: MemoryScopeFilter } {
  const scope = input.scope ?? (input.projectId ? 'project' : 'account')

  if (scope === 'project') {
    if (!input.projectId) {
      throw createInvalidMemoryInputError(
        'The project scope needs a projectId.',
      )
    }

    return {
      scope,
      filter: { kind: 'project', projectId: input.projectId },
    }
  }

  if (input.projectId) {
    throw createInvalidMemoryInputError(
      `The ${scope} scope does not take a projectId. Use the project scope `
      + 'for one project.',
    )
  }

  return { scope, filter: { kind: scope } }
}

export async function listMcpMemory(
  db: DbClient,
  userId: number,
  input: { scope?: McpMemoryScope, projectId?: string },
) {
  const { scope, filter } = resolveMcpMemoryScope(input)
  const entries = await listMemoryEntries({ db, userId, scope: filter })

  return {
    scope,
    projectId: input.projectId ?? null,
    entries: entries.map(toMcpMemoryEntry),
  }
}

/**
 * Creates an entry through `createMemoryEntry`, so the never-store and
 * sensitive-topic compliance gate and the optional TypeSafe AI check run
 * exactly as on the HTTP route. The stored origin is `user`: the user
 * authorised the client to write on their behalf.
 */
export async function addMcpMemory(
  db: DbClient,
  userId: number,
  input: McpMemoryFields & { projectId?: string },
  logger: LoggerLike,
) {
  await enforceMemoryRateLimit('write', userId)

  const entry = await createMemoryEntry(
    {
      db,
      userId,
      logger,
      jev: await resolveMemoryJevChecker({ db, userId, logger }),
    },
    {
      input: {
        projectId: input.projectId ?? null,
        category: input.category,
        title: input.title,
        description: input.description,
        body: input.body,
      },
      origin: 'user',
      complianceOrigin: MCP_MEMORY_COMPLIANCE_ORIGIN,
    },
  )

  return toMcpMemoryEntry(entry)
}

export async function updateMcpMemory(
  db: DbClient,
  userId: number,
  input: { id: string } & Partial<McpMemoryFields>,
  logger: LoggerLike,
) {
  const { id, ...patch } = input
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => {
      return value !== undefined
    }),
  ) as Partial<McpMemoryFields>

  if (Object.keys(definedPatch).length === 0) {
    throw createError({
      status: 400,
      message: 'Send at least one of category, title, description or body.',
    })
  }

  await enforceMemoryRateLimit('write', userId)

  const { entry } = await updateMemoryEntry(
    {
      db,
      userId,
      logger,
      jev: await resolveMemoryJevChecker({ db, userId, logger }),
    },
    {
      id,
      patch: definedPatch,
      origin: 'user',
      complianceOrigin: MCP_MEMORY_COMPLIANCE_ORIGIN,
    },
  )

  return toMcpMemoryEntry(entry)
}

export async function deleteMcpMemory(
  db: DbClient,
  userId: number,
  input: { id: string },
) {
  await enforceMemoryRateLimit('write', userId)

  const deleted = await deleteMemoryEntry({ db, userId, id: input.id })

  if (!deleted) {
    throw createError({
      status: 404,
      message: `No memory entry with the id "${input.id}". Call list_memory `
        + 'to find one.',
    })
  }

  return { id: deleted.id, deleted: true }
}

/**
 * Deletes memory entries like the web "Reset" and "Delete generated
 * entries" actions: `onlyGenerated` removes just what automatic extraction
 * wrote (every scope), the other scopes remove everything in that scope and
 * clear the backfill window when it can hold their entries.
 */
export async function resetMcpMemory(
  db: DbClient,
  userId: number,
  input: {
    scope: McpMemoryScope
    projectId?: string
    onlyGenerated?: boolean
    confirm: boolean
  },
) {
  if (input.confirm !== true) {
    throw createInvalidMemoryInputError(
      'Set confirm to true to delete memory entries.',
    )
  }

  if (input.onlyGenerated && input.scope !== 'all') {
    throw createInvalidMemoryInputError(
      'onlyGenerated is only valid with the all scope.',
    )
  }

  const { filter } = resolveMcpMemoryScope({
    scope: input.scope,
    projectId: input.projectId,
  })

  await enforceMemoryRateLimit('write', userId)

  if (input.onlyGenerated) {
    return { deleted: await deleteExtractedMemoryEntries({ db, userId }) }
  }

  if (input.scope !== 'project') {
    await clearBackfillWindow({ userId, db })
  }

  return {
    deleted: await resetMemoryEntries({ db, userId, scope: filter }),
  }
}
