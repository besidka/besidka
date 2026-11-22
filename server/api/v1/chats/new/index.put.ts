import { createError } from 'evlog'
import type { FileUIPart, TextUIPart } from 'ai'
import { isDataArtifactAttachmentPart } from '#shared/utils/artifacts'
import { isDataSkillInvocationPart } from '#shared/utils/skills/runtime'
import { isDataBuiltinCommandPart } from '#shared/utils/builtin-commands'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import * as schema from '~~/server/db/schema'
import {
  chatToolsSchema,
  userMessagePartsSchema,
} from '~~/server/utils/chats/request-schema'
import { insertMessageWithPublicId } from '~~/server/utils/chats/insert-message'
import { resolveArtifactAttachmentParts } from '~~/server/utils/artifacts/attachments'
import { resolveSendGoogleContent } from '~~/server/utils/google/data-guard'
import { resolveDriveFileParts } from '~~/server/utils/google/drive-parts'
import { resolveSkillInvocationPart } from '~~/server/utils/skills/runtime/invocation'
import { resolveBuiltinCommandPart } from '~~/server/utils/chats/builtin-commands'
import { validateMessageFilePolicy } from '~~/server/utils/files/file-governance'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'
import { trackLandingEvent } from '~~/server/utils/landing/analytics-events'
import {
  resolveResearchStartContext,
  startResearchJobForChat,
} from '~~/server/utils/research/start'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { requireLegalConsent } from '~~/server/utils/legal/consent'

const rules = z.object({
  parts: userMessagePartsSchema,
  tools: chatToolsSchema,
  reasoning: z.enum(['off', 'low', 'medium', 'high']).default('off'),
  projectId: z.string().nonempty().optional(),
  model: z.string().nonempty().optional(),
  memoryExcluded: z.boolean().optional(),
  research: z.object({
    answers: z.array(z.object({
      id: z.string().max(200),
      question: z.string().max(500),
      answer: z.string().max(2000),
    })).max(12).optional(),
  }).optional(),
})

function isFilePart(part: { type: string }): boolean {
  return part.type === 'file'
}

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
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

  await requireLegalConsent(userId)

  logger.set({
    userId,
    partsCount: body.data.parts.length,
    toolsCount: body.data.tools.length,
    reasoning: body.data.reasoning,
    requestedProjectId: body.data.projectId ?? null,
    hasResearch: Boolean(body.data.research),
  })

  await validateMessageFilePolicy(
    userId,
    body.data.parts,
  )

  if (body.data.research && body.data.model) {
    await resolveResearchStartContext({
      userId,
      model: body.data.model,
    })
  }

  if (body.data.research && body.data.parts.some(isFilePart)) {
    throw createError({
      message: 'Deep research only supports text-only prompts for now.',
      status: 400,
      why: 'The message included attachments, which research models ignore.',
      fix: 'Remove the attachments and resend your research request.',
    })
  }

  const db = useDb()
  const activityAt = new Date()
  const attachmentParts = await resolveArtifactAttachmentParts({
    event,
    db,
    userId,
    parts: body.data.research
      ? body.data.parts.filter(part => !isDataArtifactAttachmentPart(part))
      : body.data.parts,
    logger,
  })
  const driveParts = await resolveDriveFileParts({
    userId,
    parts: attachmentParts,
  })
  const skillParts = await resolveSkillInvocationPart({
    event,
    db,
    userId,
    parts: body.data.research
      ? driveParts.filter(part => !isDataSkillInvocationPart(part))
      : driveParts,
    logger,
  })
  const parts = await resolveBuiltinCommandPart({
    event,
    parts: body.data.research
      ? skillParts.filter(part => !isDataBuiltinCommandPart(part))
      : skillParts,
    logger,
  })

  if (parts.length === 0) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: 'A message needs text, a file, an attached skill or a command.',
    })
  }

  const sendGoogleContent = await resolveSendGoogleContent({
    db,
    userId,
    chatMessages: [],
    newMessageParts: parts,
  })
  const googleDataAt = sendGoogleContent.holdsGoogleContent
    ? activityAt
    : null

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
      ...(body.data.memoryExcluded ? { memoryExcluded: true } : {}),
      ...(googleDataAt ? { googleDataAt } : {}),
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
      parts: parts as (TextUIPart | FileUIPart)[],
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
          parts: parts as (TextUIPart | FileUIPart)[],
        },
        model: body.data.model,
        answers: body.data.research.answers,
      })
    } catch (exception) {
      const researchFailure = extractResearchStartFailure(exception)

      logger.set({
        research: {
          phase: 'start',
          errorStatus: researchFailure.status,
        },
        attributes: {
          research: {
            errorCode: researchFailure.code,
          },
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
