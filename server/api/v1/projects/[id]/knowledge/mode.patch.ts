import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import {
  knowledgeModePatchSchema,
} from '#shared/utils/project-knowledge-schemas'
import {
  KNOWLEDGE_BODY_LIMITS,
  readCappedJsonBody,
} from '~~/server/utils/knowledge/body'
import { resolveKnowledgeProject } from '~~/server/utils/knowledge/access'
import { updateKnowledgeMode } from '~~/server/utils/knowledge/ingest'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const access = await resolveKnowledgeProject(event, { isMutation: true })
  const body = await readCappedJsonBody(
    event,
    knowledgeModePatchSchema,
    KNOWLEDGE_BODY_LIMITS.small,
  )

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
      fix: 'Send a mode of auto, full or search, or null',
    })
  }

  const { userId, projectId, projectPublicId } = access

  logger.set({ userId, projectId: projectPublicId })

  const mode = await updateKnowledgeMode(
    { userId, projectId, logger },
    body.data.mode,
  )

  return { mode }
})
