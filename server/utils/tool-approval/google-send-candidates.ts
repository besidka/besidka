import type { ToolSet } from 'ai'
import { GOOGLE_SCOPES, hasScopes } from '#shared/utils/google-scopes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { buildGoogleDriveTools } from '~~/server/utils/google/drive-tools'
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
  reason?: string,
): void {
  logger.set({
    attributes: {
      googleDataGuard: {
        googleToolCandidates: count,
        ...(reason ? { googleToolCandidatesReason: reason } : {}),
      },
    },
  })
}

/**
 * The Google tools this user could get in this send, before the recipient
 * check, only for a user with an active connection in Besidka's client
 * mode that holds `drive.file`: the Drive tools today, Calendar and Gmail
 * as their children land. One connection read; a user without that
 * connection (none, `needs_reauth`, `revoked`, or the scope unticked)
 * costs nothing more and gets no candidate, which also keeps the gateway
 * safeguards off for them. Only `planGoogleSendTools` calls it, and only
 * when tool approvals and `google.drive` are active.
 */
export async function buildGoogleSendToolCandidates(input: {
  userId: number
  chatPublicId: string
  priorCalls?: number
  logger: LoggerLike
}): Promise<GoogleSendTools> {
  const db = useDb()
  const connection = await readGoogleConnection(db, input.userId, 'besidka')

  if (
    !connection
    || connection.status !== 'active'
    || !hasScopes(connection.grantedScopes, [GOOGLE_SCOPES.driveFile])
  ) {
    logCandidates(input.logger, 0, connection ? connection.status : 'none')

    return noGoogleSendTools()
  }

  const drive = await buildGoogleDriveTools({
    db,
    kv: useKV(),
    event: useEvent(),
    userId: input.userId,
    priorCalls: input.priorCalls ?? 0,
    chatGrantHashes: await readGoogleChatGrantHashes(
      db,
      input.userId,
      input.chatPublicId,
      input.logger,
    ),
    logger: input.logger,
  })

  logCandidates(input.logger, drive.entries.size)

  return drive
}
