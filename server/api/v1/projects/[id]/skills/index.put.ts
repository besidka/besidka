import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import {
  PROJECT_SKILL_LEVELS,
  PROJECT_SKILLS_MAX,
} from '#shared/utils/skills-policy'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { setProjectSkills } from '~~/server/utils/skills/project/pins'
import { requireSkillsSession } from '~~/server/utils/skills/versions/route'

const bodySchema = z.object({
  skills: z.array(z.object({
    skillId: z.string().min(1).max(64),
    level: z.enum(PROJECT_SKILL_LEVELS),
  }).strict()).max(PROJECT_SKILLS_MAX),
}).strict()

/**
 * Replaces the skills pinned to a project. The body is the whole list in
 * order; the server checks ownership, the limits and the token cap, and
 * never changes a skill itself.
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

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const view = await setProjectSkills(
    useDb(),
    useFileStorage(),
    userId,
    params.data.id,
    body.data.skills,
    logger,
  )

  logger.set({
    projectId: params.data.id,
    attributes: { skills: { projectPinsSet: { count: view.pins.length } } },
  })

  return view
})
