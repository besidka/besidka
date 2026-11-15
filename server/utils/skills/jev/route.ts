import type { RequestEvent } from 'nuxt/server'
import { readValidatedBody } from 'nuxt/server'
import { createError } from 'evlog'
import { z } from 'zod'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { assertNotCrossSiteRequest } from '~~/server/utils/cross-site-guard'
import { requireLegalConsent } from '~~/server/utils/legal/consent'
import { enforceSkillScreenRateLimit } from '~~/server/utils/skills/import/rate-limit'
import { requireSkillsSession } from '~~/server/utils/skills/versions/route'

const SCREEN_BODY_MAX_BYTES = 256

const screenBodySchema = z.object({
  rest: z.boolean().optional(),
}).strict().optional()

/**
 * What both screen routes check before any work: a signed-in user with the
 * `skills` flag, a request that is not cross-site, the legal consent, and the
 * hourly screen limit. Returns the user, the request logger and whether the
 * user asked to "Check the rest".
 */
export async function openSkillScreenRequest(event: RequestEvent) {
  const { logger, userId } = await requireSkillsSession(event)

  assertNotCrossSiteRequest(event)

  await requireLegalConsent(userId)
  await enforceSkillScreenRateLimit(event, userId)

  assertRequestBodyLength(event, SCREEN_BODY_MAX_BYTES)

  const body = await readValidatedBody(event, screenBodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      code: 'invalid-request',
      why: 'The body must be empty or { rest?: boolean }',
      fix: 'Send { rest: true } to check the chunks that were left out',
    })
  }

  return { logger, userId, rest: body.data?.rest === true }
}
