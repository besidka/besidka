import { useLogger, createError } from 'evlog'
import type { FileUIPart, TextUIPart } from 'ai'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  chatToolSchema,
  userMessagePartsSchema,
} from '~~/server/utils/chats/request-schema'
import { validateMessageFilePolicy } from '~~/server/utils/files/file-governance'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'
import { trackLandingEvent } from '~~/server/utils/landing/analytics-events'

const rules = z.object({
  parts: userMessagePartsSchema,
  tools: z.array(chatToolSchema),
  reasoning: z.enum(['off', 'low', 'medium', 'high']).default('off'),
  projectId: z.string().nonempty().optional(),
})

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const body = await readValidatedBody(event, rules.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const session = await useUserSession()

  if (!session?.user) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)

  logger.set({
    userId,
    partsCount: body.data.parts.length,
    toolsCount: body.data.tools.length,
    reasoning: body.data.reasoning,
    requestedProjectId: body.data.projectId ?? null,
  })

  await validateMessageFilePolicy(
    userId,
    body.data.parts,
  )

  const db = useDb()
  const activityAt = new Date()

  let projectId: string | undefined

  if (body.data.projectId) {
    const project = await db.query.projects.findFirst({
      where: {
        id: body.data.projectId!,
        userId,
      },
      columns: { id: true },
    })

    if (project) {
      projectId = project.id
    }
  }

  const chat = await db
    .insert(schema.chats)
    .values({
      userId,
      activityAt,
      ...(projectId ? { projectId } : {}),
    })
    .returning({
      id: schema.chats.id,
      slug: schema.chats.slug,
    })
    .get()

  await db
    .insert(schema.messages)
    .values({
      chatId: chat.id,
      role: 'user',
      parts: body.data.parts as (TextUIPart | FileUIPart)[],
      tools: body.data.tools,
      reasoning: body.data.reasoning,
    })

  if (projectId) {
    await db.update(schema.projects)
      .set({ activityAt })
      .where(and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.userId, userId),
      ))

    await markProjectsMemoryStale([projectId], userId, db)
  }

  trackLandingEvent('new_chat_created', undefined, event)

  return {
    slug: chat.slug,
  }
})
