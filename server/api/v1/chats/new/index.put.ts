import type { TextUIPart, FileUIPart } from 'ai'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { validateMessageFilePolicy } from '~~/server/utils/files/file-governance'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'

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
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, rules.safeParse)

  if (body.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: body.error,
    })
  }

  const session = await useUserSession()

  if (!session?.user) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)

  await validateMessageFilePolicy(
    userId,
    body.data.parts,
  )

  const db = useDb()
  const activityAt = new Date()

  let projectId: string | undefined

  if (body.data.projectId) {
    const project = await db.query.projects.findFirst({
      where(projects, { and, eq }) {
        return and(
          eq(projects.id, body.data.projectId!),
          eq(projects.userId, userId),
        )
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

  return {
    slug: chat.slug,
  }
})
