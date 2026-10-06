import { createError } from 'evlog'
import { gatewayIds } from '#shared/utils/gateways'
import { getModelResearch } from '#shared/utils/research'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { normalizeChatError } from '~~/server/utils/chats/errors'
import {
  buildFallbackChatTitle,
  CHAT_TITLE_DEFAULT,
} from '~~/server/utils/chats/title'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  defineEventHandler,
  readValidatedBody,
} from 'nuxt/server'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const params = z.object({
    slug: z.ulid(),
  }).safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const body = await readValidatedBody(event, z.object({
    model: z.string().nonempty(),
    gateway: z.enum(gatewayIds).optional(),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const userId = parseInt(session.user.id)
  const chat = await db.query.chats.findFirst({
    where: {
      slug: params.data.slug,
      userId,
    },
    columns: {
      id: true,
      title: true,
      projectId: true,
    },
    with: {
      messages: {
        limit: 1,
        where: {
          role: 'user',
        },
        orderBy: { createdAt: 'asc' },
        columns: {
          parts: true,
        },
      },
    },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found.',
      status: 404,
    })
  }

  if (chat.title) {
    return chat.title
  }

  const gatewayId = body.data.gateway

  const initialMessage = chat.messages[0]

  if (!initialMessage) {
    return null
  }

  const initialText = getFirstTextPart(initialMessage.parts)
  let title = ''

  const runtimeConfig = useRuntimeConfig()

  try {
    if (!initialText.trim()) {
      title = CHAT_TITLE_DEFAULT
    } else if (
      runtimeConfig.researchMockEnabled
      && initialText.trim().toLowerCase().startsWith('mock:')
    ) {
      title = buildMockChatTitle(initialText)
    } else if (gatewayId) {
      const { generateChatTitle } = await useGateway(
        gatewayId,
        session.user.id,
        body.data.model,
        [],
        'off',
      )

      title = await generateChatTitle(initialText)
    } else {
      const { provider, model } = useChatProvider(body.data.model)
      const research = getModelResearch(model)
      const titleModelId = research ? research.assistModel : model.id

      switch (provider.id) {
        case 'openai': {
          const { generateChatTitle } = await useOpenAI(
            session.user.id,
            titleModelId,
            [],
            'off',
          )

          title = await generateChatTitle(initialText)
          break
        }
        case 'google': {
          const { generateChatTitle } = await useGoogle(
            session.user.id,
            titleModelId,
            [],
            'off',
          )

          title = await generateChatTitle(initialText)
          break
        }
        case 'anthropic': {
          const { generateChatTitle } = await useAnthropic(
            session.user.id,
            titleModelId,
            [],
            'off',
          )

          title = await generateChatTitle(initialText)
          break
        }
        case 'xai': {
          const { generateChatTitle } = await useXai(
            session.user.id,
            titleModelId,
            [],
            'off',
          )

          title = await generateChatTitle(initialText)
          break
        }
        case 'deepseek': {
          const { generateChatTitle } = await useDeepSeek(
            session.user.id,
            titleModelId,
            [],
            'off',
          )

          title = await generateChatTitle(initialText)
          break
        }
        case 'moonshotai': {
          const { generateChatTitle } = await useMoonshotAi(
            session.user.id,
            titleModelId,
            [],
            'off',
          )

          title = await generateChatTitle(initialText)
          break
        }
        case 'qwen': {
          const { generateChatTitle } = await useQwen(
            session.user.id,
            titleModelId,
            [],
            'off',
          )

          title = await generateChatTitle(initialText)
          break
        }
      }
    }
  } catch (exception) {
    const chatError = normalizeChatError({ error: exception })

    useRequestLogger(event).set({
      attributes: {
        titleGeneration: {
          fallback: true,
          reason: 'error',
          error: exceptionMessage(exception),
          status: chatError.status,
        },
      },
    })

    title = buildFallbackChatTitle(initialText)
  }

  title = title.trim() || CHAT_TITLE_DEFAULT

  const { title: savedTitle } = await db.update(schema.chats)
    .set({
      title,
    })
    .where(eq(schema.chats.id, chat.id))
    .returning({ title: schema.chats.title })
    .get()

  return savedTitle
})

function getFirstTextPart(parts: UIMessage['parts'] | null | undefined) {
  const textPart = parts?.find((part) => {
    return part.type === 'text'
  })

  return textPart?.type === 'text' ? textPart.text ?? '' : ''
}

export function buildMockChatTitle(topic: string): string {
  const withoutPrefix = topic.trim()
    .replace(/^mock:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!withoutPrefix) {
    return 'Mock research'
  }

  return withoutPrefix.length > 60
    ? `${withoutPrefix.slice(0, 60).trimEnd()}…`
    : withoutPrefix
}
