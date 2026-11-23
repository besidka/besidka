import type { ToolSet } from 'ai'
import { GOOGLE_GMAIL_TOOL_NAMES } from '#shared/utils/google-gmail-tools'
import { GOOGLE_SCOPES, hasScopes } from '#shared/utils/google-scopes'
import {
  GOOGLE_TOOL_CATALOG,
  findGoogleCatalogTool,
} from '#shared/utils/google-tool-catalog'
import type {
  GoogleService,
  GoogleToolPermissionMode,
} from '#shared/utils/google-tool-catalog'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { checkGoogleByoAccess } from '~~/server/utils/google/byo-access'
import type { GoogleByoFeatureState } from '~~/server/utils/google/byo-access'
import { buildGoogleByoTools } from '~~/server/utils/google/byo-tools'
import { buildGoogleCalendarTools } from '~~/server/utils/google/calendar-tools'
import { buildGoogleReferenceIndex } from '~~/server/utils/google/chat-references'
import { buildGoogleDriveTools } from '~~/server/utils/google/drive-tools'
import { buildGoogleDriveWriteTools } from '~~/server/utils/google/drive-write-tools'
import { createGoogleSendGuard } from '~~/server/utils/google/send-guard'
import { readGoogleConnection } from '~~/server/utils/google/store'
import {
  loadGoogleToolPermissionModes,
  pickGoogleToolPermissionMode,
} from '~~/server/utils/google/tool-permissions'
import type { GoogleToolPermissionModes } from '~~/server/utils/google/tool-permissions'
import { readGoogleChatSettings } from '~~/server/utils/tool-approval/google'
import type { GoogleChatSettings } from '~~/server/utils/tool-approval/google'
import { buildBlockedGoogleEntry } from '~~/server/utils/tool-approval/send'
import type { SendToolEntry } from '~~/server/utils/tool-approval/send'

/**
 * The Google tools of one send and their approval entries, built with
 * `buildGoogleApprovalEntry`. A tool the user set to Blocked is not in
 * `tools`; its entry is an entry-only `buildBlockedGoogleEntry` record, so
 * an approval given before the Block is denied as blocked on resume.
 * `permissionModes` are the stored Google modes the send resolved (a tool
 * with no entry means "ask"), which the continuation reads.
 */
export interface GoogleSendTools {
  tools: ToolSet
  entries: ReadonlyMap<string, SendToolEntry>
  permissionModes?: ReadonlyMap<string, GoogleToolPermissionMode>
}

export function noGoogleSendTools(): GoogleSendTools {
  return { tools: {}, entries: new Map() }
}

async function readGooglePermissionModes(
  db: ReturnType<typeof useDb>,
  userId: number,
  toolNames: readonly string[],
  logger: LoggerLike,
): Promise<GoogleToolPermissionModes> {
  try {
    return await loadGoogleToolPermissionModes(userId, db)
  } catch {
    logger.set({
      attributes: { googleDataGuard: { googleToolPermissions: 'unavailable' } },
    })

    return new Map(toolNames.map((toolName) => {
      return [toolName, 'blocked' as const]
    }))
  }
}

/**
 * Takes the tools the user set to Blocked out of a send's Google tools. Each
 * keeps an entry-only Blocked record, so the continuation answers an
 * approval given before the Block with the blocked denial instead of "no
 * longer available". Only removes tools: the data guard, the gateway
 * safeguards and the recipient check depend on the chat alone.
 */
export function dropBlockedGoogleTools(
  google: GoogleSendTools,
  modes: GoogleToolPermissionModes,
): GoogleSendTools {
  const tools: ToolSet = {}
  const entries = new Map<string, SendToolEntry>()

  for (const [toolName, entry] of google.entries) {
    if (pickGoogleToolPermissionMode(toolName, modes) !== 'blocked') {
      entries.set(toolName, entry)

      continue
    }

    entries.set(toolName, buildBlockedGoogleEntry({
      toolName,
      kind: entry.descriptor.access === 'read'
        && !entry.descriptor.destructiveHint
        ? 'read'
        : 'write',
    }))
  }

  for (const [toolName, tool] of Object.entries(google.tools)) {
    if (pickGoogleToolPermissionMode(toolName, modes) !== 'blocked') {
      tools[toolName] = tool
    }
  }

  return { tools, entries, permissionModes: modes }
}

/**
 * The Google modes of a send with every tool of a service switched off in
 * the chat set to Blocked, on top of the stored modes. A tool name that is
 * not in the catalog counts as off too, so an unknown name is never offered.
 * `dropBlockedGoogleTools` then removes those tools in the same pass as the
 * tools the user blocked, and the continuation reads the same map, so an
 * approval given before a service was switched off is denied as blocked.
 */
export function withGoogleServicesOffBlocked(
  modes: GoogleToolPermissionModes,
  servicesOff: readonly GoogleService[],
  toolNames: Iterable<string>,
): GoogleToolPermissionModes {
  const merged = new Map(modes)

  for (const tool of GOOGLE_TOOL_CATALOG) {
    if (servicesOff.includes(tool.service)) {
      merged.set(tool.name, 'blocked')
    }
  }

  for (const toolName of toolNames) {
    if (!findGoogleCatalogTool(toolName)) {
      merged.set(toolName, 'blocked')
    }
  }

  return merged
}

function logCandidates(
  logger: LoggerLike,
  count: number,
  reasons: { drive?: string, byo?: string },
  servicesOff: readonly GoogleService[],
): void {
  logger.set({
    attributes: {
      googleDataGuard: {
        googleToolCandidates: count,
        ...(servicesOff.length ? { googleServicesOff: servicesOff } : {}),
        ...(reasons.drive ? { googleToolCandidatesReason: reasons.drive } : {}),
        ...(reasons.byo ? { googleByoToolCandidatesReason: reasons.byo } : {}),
      },
    },
  })
}

type DbClient = ReturnType<typeof useDb>

async function buildByoCandidates(input: {
  db: DbClient
  userId: number
  chatPublicId: string
  gmailActive: boolean
  calendarActive: boolean
  featureState?: GoogleByoFeatureState
  priorParts: readonly unknown[]
  readChatGrantHashes: () => Promise<Readonly<Record<string, string>>>
  guard: ReturnType<typeof createGoogleSendGuard>
  logger: LoggerLike
}): Promise<{ tools: GoogleSendTools, reason?: string }> {
  const connection = await readGoogleConnection(input.db, input.userId, 'byo')

  if (!connection || connection.status !== 'active') {
    return {
      tools: noGoogleSendTools(),
      reason: connection ? connection.status : 'none',
    }
  }

  const verdict = await checkGoogleByoAccess({
    db: input.db,
    userId: input.userId,
    logger: input.logger,
    ...(input.featureState ? { featureState: input.featureState } : {}),
  })

  if (verdict !== 'allowed') {
    return { tools: noGoogleSendTools(), reason: verdict }
  }

  const chatGrantHashes = await input.readChatGrantHashes()
  const index = await buildGoogleReferenceIndex({
    db: input.db,
    userId: input.userId,
    chatPublicId: input.chatPublicId,
    priorParts: input.priorParts,
    grantedScopes: connection.grantedScopes,
    logger: input.logger,
  })
  const byo = await buildGoogleByoTools({
    db: input.db,
    kv: useKV(),
    userId: input.userId,
    chatPublicId: input.chatPublicId,
    accountEmail: connection.googleEmail,
    priorParts: input.priorParts,
    index,
    grantedScopes: connection.grantedScopes,
    chatGrantHashes,
    guard: input.guard,
    logger: input.logger,
  })
  const driveWrite = await buildGoogleDriveWriteTools({
    db: input.db,
    kv: useKV(),
    userId: input.userId,
    grantedScopes: connection.grantedScopes,
    chatGrantHashes,
    index,
    guard: input.guard,
    logger: input.logger,
  })
  const calendar = input.calendarActive
    ? await buildGoogleCalendarTools({
      db: input.db,
      kv: useKV(),
      userId: input.userId,
      grantedScopes: connection.grantedScopes,
      chatGrantHashes,
      guard: input.guard,
      logger: input.logger,
    })
    : noGoogleSendTools()
  const allowed = [...byo.entries.keys()].filter((toolName) => {
    return input.gmailActive || !GOOGLE_GMAIL_TOOL_NAMES.includes(toolName)
  })
  const allowedTools = {
    ...Object.fromEntries(
      Object.entries(byo.tools).filter(([toolName]) => {
        return allowed.includes(toolName)
      }),
    ),
    ...driveWrite.tools,
    ...calendar.tools,
  }
  const allowedEntries = new Map([
    ...[...byo.entries].filter(([toolName]) => allowed.includes(toolName)),
    ...driveWrite.entries,
    ...calendar.entries,
  ])

  return {
    tools: { tools: allowedTools, entries: allowedEntries },
    ...(allowedEntries.size === 0 ? { reason: 'no-scope' } : {}),
  }
}

/**
 * The Google tools this user could get in this send, before the recipient
 * check. The Drive tools only for a user with an active connection in
 * Besidka's client mode that holds `drive.file`. The bring-your-own tools
 * (Gmail, Drive search and the read of a found file) only when
 * `google.byo` is active (and `google.gmail` for the Gmail ones), the stored
 * `byo` connection is active (read first, so a user without one costs one
 * read), the owner's admin gate passes (`checkGoogleByoAccess` on the send's
 * own feature state, `featureState`, so no extra read) and the connection
 * grants the scope each tool needs; a missing scope removes only the tools
 * that need it. Every call of those tools runs the gate again on fresh
 * state. A user without the flags costs no query at all, and gets no
 * candidate, which also keeps the gateway safeguards off for them. Every
 * tool of the send shares one chain and one call count
 * (`createGoogleSendGuard`). `priorParts` are the parts of the reply being
 * resumed, whose search results the reads accept. After those gates the
 * tools of a service switched off in this chat (`servicesOff`, else the
 * chat's stored switches, from the same row read as the grants) are dropped
 * together with the Blocked tools, each keeping an entry-only Blocked record.
 * A switch only removes tools: it never changes the gateway safeguards, the
 * recipient check or the chat's Google-data flag. Only
 * `planGoogleSendTools` calls it, and only when tool approvals are active.
 */
export async function buildGoogleSendToolCandidates(input: {
  userId: number
  chatPublicId: string
  priorCalls?: number
  driveActive?: boolean
  byoActive?: boolean
  gmailActive?: boolean
  calendarActive?: boolean
  servicesOff?: readonly GoogleService[]
  featureState?: GoogleByoFeatureState
  priorParts?: readonly unknown[]
  logger: LoggerLike
}): Promise<GoogleSendTools> {
  const db = useDb()
  const guard = createGoogleSendGuard({
    priorCalls: input.priorCalls ?? 0,
    logger: input.logger,
  })
  let chatSettings: GoogleChatSettings | null = null
  const readChatSettings = async () => {
    chatSettings ??= await readGoogleChatSettings(
      db,
      input.userId,
      input.chatPublicId,
      input.logger,
    )

    return chatSettings
  }
  const readChatGrantHashes = async () => {
    return (await readChatSettings()).grantHashes
  }
  const reasons: { drive?: string, byo?: string } = {}
  let combined = noGoogleSendTools()

  if (input.driveActive !== false) {
    const connection = await readGoogleConnection(db, input.userId, 'besidka')

    if (
      connection
      && connection.status === 'active'
      && hasScopes(connection.grantedScopes, [GOOGLE_SCOPES.driveFile])
    ) {
      combined = await buildGoogleDriveTools({
        db,
        kv: useKV(),
        event: useEvent(),
        userId: input.userId,
        priorCalls: input.priorCalls ?? 0,
        chatGrantHashes: await readChatGrantHashes(),
        guard,
        logger: input.logger,
      })
    } else {
      reasons.drive = connection ? connection.status : 'none'
    }
  }

  if (input.byoActive) {
    const byo = await buildByoCandidates({
      db,
      userId: input.userId,
      chatPublicId: input.chatPublicId,
      gmailActive: input.gmailActive === true,
      calendarActive: input.calendarActive === true,
      ...(input.featureState ? { featureState: input.featureState } : {}),
      priorParts: input.priorParts ?? [],
      readChatGrantHashes,
      guard,
      logger: input.logger,
    })

    if (byo.reason) {
      reasons.byo = byo.reason
    }

    combined = {
      tools: { ...combined.tools, ...byo.tools.tools },
      entries: new Map([...combined.entries, ...byo.tools.entries]),
    }
  }

  const servicesOff = input.servicesOff
    ?? (combined.entries.size > 0
      ? (await readChatSettings()).servicesOff
      : [])

  if (combined.entries.size > 0) {
    const toolNames = [...combined.entries.keys()]

    combined = dropBlockedGoogleTools(
      combined,
      withGoogleServicesOffBlocked(
        await readGooglePermissionModes(
          db,
          input.userId,
          toolNames,
          input.logger,
        ),
        servicesOff,
        toolNames,
      ),
    )
  }

  logCandidates(
    input.logger,
    Object.keys(combined.tools).length,
    reasons,
    servicesOff,
  )

  return combined
}
