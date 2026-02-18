import type { TextUIPart, FileUIPart } from 'ai'
import * as schema from '~~/server/db/schema'
import { validateMessageFilePolicy } from '~~/server/utils/files/file-governance'

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
  reasoning: z.boolean().default(false),
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

  const chat = await db
    .insert(schema.chats)
    .values({
      userId,
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

  return {
    slug: chat.slug,
  }
})
