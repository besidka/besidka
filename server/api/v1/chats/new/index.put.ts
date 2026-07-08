import { useLogger, createError } from 'evlog'
import type { TextUIPart, FileUIPart } from 'ai'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import * as schema from '~~/server/db/schema'
import { insertMessageWithPublicId } from '~~/server/utils/chats/insert-message'
import { validateMessageFilePolicy } from '~~/server/utils/files/file-governance'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'
import { trackLandingEvent } from '~~/server/utils/landing/analytics-events'
import {
  resolveResearchStartContext,
  startResearchJobForChat,
} from '~~/server/utils/research/start'

const textPart = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
})

const filePart = z.object({
  type: z.literal('file'),
  mediaType: z.string(),
  filename: z.string().optional(),
  url: z.string(),
  providerMetadata: z.any().optional(),
})

const rules = z.object({
  parts: z.array(z.union([textPart, filePart])).nonempty().refine((parts) => {
    return parts.some(part => part.type === 'text')
  }),
  tools: z.array(z.enum(['web_search'])),
  reasoning: z.enum(['off', 'low', 'medium', 'high']).default('off'),
  projectId: z.string().nonempty().optional(),
  model: z.string().nonempty().optional(),
  research: z.object({
    level: z.enum(['quick', 'thorough']),
    answers: z.array(z.object({
      id: z.string().max(200),
      question: z.string().max(500),
      answer: z.string().max(2000),
    })).max(12).optional(),
  }).optional(),
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

  if (body.data.research && !body.data.model) {
    throw createError({
      message: 'A model is required to start deep research.',
      status: 400,
      why: 'The research option was set without a model.',
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
    researchLevel: body.data.research?.level ?? null,
  })

  await validateMessageFilePolicy(
    userId,
    body.data.parts,
  )

  if (body.data.research && body.data.model) {
    await resolveResearchStartContext({
      userId,
      model: body.data.model,
      level: body.data.research.level,
    })
  }

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

  const userMessagePublicId = ulid()

  await insertMessageWithPublicId({
    db,
    values: {
      chatId: chat.id,
      role: 'user',
      parts: body.data.parts as (TextUIPart | FileUIPart)[],
      tools: body.data.tools,
      reasoning: body.data.reasoning,
    },
    publicId: userMessagePublicId,
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

  if (body.data.research && body.data.model) {
    try {
      await startResearchJobForChat({
        db,
        event,
        logger,
        userId,
        chat: {
          id: chat.id,
          slug: chat.slug,
          projectId: projectId ?? null,
        },
        userMessage: {
          id: userMessagePublicId,
          parts: body.data.parts as (TextUIPart | FileUIPart)[],
        },
        model: body.data.model,
        level: body.data.research.level,
        answers: body.data.research.answers,
      })
    } catch (exception) {
      const researchFailure = extractResearchStartFailure(exception)

      logger.set({
        research: {
          phase: 'start',
          errorCode: researchFailure.code,
          errorStatus: researchFailure.status,
        },
      })

      return {
        slug: chat.slug,
        researchError: {
          message: researchFailure.message,
          why: researchFailure.why,
          fix: researchFailure.fix,
        },
      }
    }
  }

  return {
    slug: chat.slug,
  }
})

interface ResearchStartFailure {
  message: string
  why?: string
  fix?: string
  code?: string
  status?: number
}

function extractResearchStartFailure(error: unknown): ResearchStartFailure {
  if (error instanceof Error) {
    const record = error as Error & {
      code?: string
      status?: number
      why?: string
      fix?: string
    }

    return {
      message: record.message || 'Could not start the research job.',
      why: record.why,
      fix: record.fix,
      code: record.code,
      status: record.status,
    }
  }

  return { message: 'Could not start the research job.' }
}
