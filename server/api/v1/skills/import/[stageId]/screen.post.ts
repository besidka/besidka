import { defineEventHandler } from 'nuxt/server'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { screenSkillStage } from '~~/server/utils/skills/jev/screen'
import { openSkillScreenRequest } from '~~/server/utils/skills/jev/route'

/**
 * The optional TypeSafe AI check of a skill that waits for review after an
 * import preview. It runs on the user's own key and only when the role
 * "Prompt-injection screening" is on; without a key or with the role off the
 * answer is `{ state: 'unavailable' }` and nothing is sent. Jev is add-only:
 * the answer lists extra highlights and the line ranges that were not
 * checked, never a "clean" state, and every failure leaves the review as it
 * is without the check. `{ rest: true }` checks chunks the first request did
 * not reach.
 */
export default defineEventHandler(async (event) => {
  const { logger, userId, rest } = await openSkillScreenRequest(event)
  const { stageId } = getDecodedRouterParams(event)

  return await screenSkillStage({
    db: useDb(),
    kv: useKV(),
    bucket: useFileStorage(),
    userId,
    stageId: stageId ?? '',
    rest,
    logger,
  })
})
