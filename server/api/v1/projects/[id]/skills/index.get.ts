import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { listProjectSkills } from '~~/server/utils/skills/project/pins'
import { requireSkillsSession } from '~~/server/utils/skills/versions/route'

/**
 * The skills pinned to a project with their level, the state each skill is
 * in now and the token estimate of the always-loaded ones.
 */
export default defineEventHandler(async (event) => {
  const { logger, userId } = await requireSkillsSession(event)
  const params = z.object({
    id: z.string().nonempty(),
  }).safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const view = await listProjectSkills(
    useDb(),
    useFileStorage(),
    userId,
    params.data.id,
    logger,
  )

  logger.set({
    projectId: params.data.id,
    attributes: { skills: { projectPins: { count: view.pins.length } } },
  })

  return view
})
