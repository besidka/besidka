import { createError } from 'evlog'
import {
  defineEventHandler,
  readValidatedBody,
  setResponseStatus,
} from 'nuxt/server'
import {
  knowledgeNoteCreateSchema,
} from '#shared/utils/project-knowledge-schemas'
import { resolveKnowledgeProject } from '~~/server/utils/knowledge/access'
import { createKnowledgeNote } from '~~/server/utils/knowledge/ingest'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const access = await resolveKnowledgeProject(event)
  const body = await readValidatedBody(
    event,
    knowledgeNoteCreateSchema.safeParse,
  )

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
      fix: 'Send a title and a body for the note',
    })
  }

  const { userId, projectId, projectPublicId } = access

  logger.set({ userId, projectId: projectPublicId })

  const note = await createKnowledgeNote(
    { userId, projectId, logger },
    body.data,
  )

  setResponseStatus(event, 201)

  return note
})
