import { JEV_INJECTION_SCREENING } from '#shared/utils/jev-policy'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { screenTextsForInjection } from '~~/server/utils/jev/injection-screening'
import type { InjectionVerdict } from '~~/server/utils/jev/injection-screening'
import { resolveJevRoleModel } from '~~/server/utils/jev/roles'

export type KnowledgeScreeningVerdict = InjectionVerdict | 'off'

/**
 * Screens project knowledge texts at ingestion, once per request, with the
 * user's TypeSafe AI key. Returns one verdict per text. Without a key or
 * with the role switched off every text is `off`, so the item is stored
 * `ready` exactly as without the key. A Jev failure, or the per-request
 * budget `JEV_INJECTION_SCREENING.maxCallsPerKnowledgeRequest`, leaves the
 * texts not decided yet `unscreened`: they are stored `ready` too and queued
 * for the knowledge sweep to screen later. No D1 read happens when there is
 * nothing to screen.
 */
export async function screenKnowledgeTexts(input: {
  userId: number
  texts: string[]
  logger?: LoggerLike
}): Promise<KnowledgeScreeningVerdict[]> {
  const switchedOff: KnowledgeScreeningVerdict[] = input.texts.map(() => 'off')

  if (input.texts.length === 0) {
    return switchedOff
  }

  const model = await resolveJevRoleModel({
    db: useDb(),
    userId: input.userId,
    role: 'injectionScreening',
    logger: input.logger,
  })

  if (!model) {
    return switchedOff
  }

  return await screenTextsForInjection({
    model,
    texts: input.texts,
    source: 'knowledge',
    timeoutMs: JEV_INJECTION_SCREENING.timeoutMs,
    maxCalls: JEV_INJECTION_SCREENING.maxCallsPerKnowledgeRequest,
    logger: input.logger,
  })
}
