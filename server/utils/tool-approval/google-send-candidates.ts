import type { ToolSet } from 'ai'
import { GOOGLE_GMAIL_TOOL_NAMES } from '#shared/utils/google-gmail-tools'
import { GOOGLE_SCOPES, hasScopes } from '#shared/utils/google-scopes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { checkGoogleByoAccess } from '~~/server/utils/google/byo-access'
import type { GoogleByoFeatureState } from '~~/server/utils/google/byo-access'
import { buildGoogleByoTools } from '~~/server/utils/google/byo-tools'
import { buildGoogleDriveTools } from '~~/server/utils/google/drive-tools'
import { createGoogleSendGuard } from '~~/server/utils/google/send-guard'
import { readGoogleConnection } from '~~/server/utils/google/store'
import { readGoogleChatGrantHashes } from '~~/server/utils/tool-approval/google'
import type { SendToolEntry } from '~~/server/utils/tool-approval/send'

/**
 * The Google tools of one send and their approval entries, built with
 * `buildGoogleApprovalEntry`.
 */
export interface GoogleSendTools {
  tools: ToolSet
  entries: ReadonlyMap<string, SendToolEntry>
}

export function noGoogleSendTools(): GoogleSendTools {
  return { tools: {}, entries: new Map() }
}

function logCandidates(
  logger: LoggerLike,
  count: number,
  reasons: { drive?: string, byo?: string },
): void {
  logger.set({
    attributes: {
      googleDataGuard: {
        googleToolCandidates: count,
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

  const byo = await buildGoogleByoTools({
    db: input.db,
    kv: useKV(),
    userId: input.userId,
    chatPublicId: input.chatPublicId,
    accountEmail: connection.googleEmail,
    priorParts: input.priorParts,
    grantedScopes: connection.grantedScopes,
    chatGrantHashes: await input.readChatGrantHashes(),
    guard: input.guard,
    logger: input.logger,
  })
  const allowed = [...byo.entries.keys()].filter((toolName) => {
    return input.gmailActive || !GOOGLE_GMAIL_TOOL_NAMES.includes(toolName)
  })

  return {
    tools: {
      tools: Object.fromEntries(
        Object.entries(byo.tools).filter(([toolName]) => {
          return allowed.includes(toolName)
        }),
      ),
      entries: new Map(
        [...byo.entries].filter(([toolName]) => allowed.includes(toolName)),
      ),
    },
    ...(allowed.length === 0 ? { reason: 'no-scope' } : {}),
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
 * resumed, whose search results the reads accept. Only
 * `planGoogleSendTools` calls it, and only when tool approvals are active.
 */
export async function buildGoogleSendToolCandidates(input: {
  userId: number
  chatPublicId: string
  priorCalls?: number
  driveActive?: boolean
  byoActive?: boolean
  gmailActive?: boolean
  featureState?: GoogleByoFeatureState
  priorParts?: readonly unknown[]
  logger: LoggerLike
}): Promise<GoogleSendTools> {
  const db = useDb()
  const guard = createGoogleSendGuard({
    priorCalls: input.priorCalls ?? 0,
    logger: input.logger,
  })
  let chatGrantHashes: Record<string, string> | null = null
  const readChatGrantHashes = async () => {
    chatGrantHashes ??= await readGoogleChatGrantHashes(
      db,
      input.userId,
      input.chatPublicId,
      input.logger,
    )

    return chatGrantHashes
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

  logCandidates(input.logger, combined.entries.size, reasons)

  return combined
}
