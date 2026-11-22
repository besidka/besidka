import type { ToolSet } from 'ai'
import type { LoggerLike } from '~~/server/utils/files/logger'
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

/**
 * The Google tools this user could get in this send, before the recipient
 * check: the Drive, Calendar and Gmail children add theirs here, only for a
 * user with an active connection. Until then the set is empty. Only
 * `planGoogleSendTools` calls it.
 */
export async function buildGoogleSendToolCandidates(input: {
  userId: number
  chatPublicId: string
  logger: LoggerLike
}): Promise<GoogleSendTools> {
  input.logger.set({
    attributes: { googleDataGuard: { googleToolCandidates: 0 } },
  })

  return noGoogleSendTools()
}
