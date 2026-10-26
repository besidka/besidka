import { JEV_INJECTION_SCREENING } from '#shared/utils/jev-policy'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { screenTextsForInjection } from '~~/server/utils/jev/injection-screening'
import { resolveJevRoleModel } from '~~/server/utils/jev/roles'

/**
 * Screens project knowledge texts at ingestion, once per item, with the
 * user's TypeSafe AI key. Returns one flag per text: `true` only for a text
 * Jev flagged. Without a key, with the role switched off, or on any Jev
 * failure every text comes back `false`, so the item is stored `ready` as it
 * would be without the key. No D1 read happens when there is nothing to
 * screen.
 */
export async function screenKnowledgeTexts(input: {
  userId: number
  texts: string[]
  logger?: LoggerLike
}): Promise<boolean[]> {
  const unflagged = input.texts.map(() => false)

  if (input.texts.length === 0) {
    return unflagged
  }

  const model = await resolveJevRoleModel({
    db: useDb(),
    userId: input.userId,
    role: 'injectionScreening',
    logger: input.logger,
  })

  if (!model) {
    return unflagged
  }

  const verdicts = await screenTextsForInjection({
    model,
    texts: input.texts,
    source: 'knowledge',
    timeoutMs: JEV_INJECTION_SCREENING.timeoutMs,
    logger: input.logger,
  })

  return verdicts.map(verdict => verdict === 'flagged')
}
