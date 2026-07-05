import type { UIMessage } from 'ai'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import { createError } from 'evlog'
import { resolveActiveShareBySlug } from '~~/server/utils/chats/share'
import { rewriteShareFileParts } from '~~/server/utils/files/rewrite-share-file-urls'

const paramsRules = z.object({
  slug: z.string().nonempty(),
})

export default defineEventHandler(async (event) => {
  const params = await getValidatedRouterParams(
    event,
    paramsRules.safeParse,
  )

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const share = await resolveActiveShareBySlug(params.data.slug, event)

  if (!share) {
    throw createError({
      message: 'Shared chat not found',
      status: 404,
    })
  }

  const chat = await useDb().query.chats.findFirst({
    where: { id: share.chatId },
    columns: {
      title: true,
    },
    with: {
      messages: {
        columns: {
          id: true,
          publicId: true,
          role: true,
          parts: true,
          reasoning: true,
          createdAt: true,
        },
      },
    },
  })

  if (!chat) {
    throw createError({
      message: 'Shared chat not found',
      status: 404,
    })
  }

  const persistedMessages = chat.messages
    .filter((message) => {
      return isPersistedMessageRole(message.role)
    })
    .map((message) => {
      return {
        id: message.publicId ?? message.id,
        role: message.role,
        parts: message.parts,
        reasoning: message.reasoning,
        createdAt: message.createdAt,
      }
    })

  const messagesWithResolvedFiles = share.showFiles
    ? await rewriteShareFileParts(persistedMessages, share.id, event)
    : stripFileParts(persistedMessages)

  const messages = messagesWithResolvedFiles.map((message) => {
    return {
      id: message.id,
      role: message.role,
      parts: message.parts,
      reasoning: message.reasoning,
      ...(share.showMetadata ? { createdAt: message.createdAt } : {}),
    }
  })

  return {
    title: chat.title,
    indexable: share.indexable,
    showFiles: share.showFiles,
    showMetadata: share.showMetadata,
    messages,
  }
})

function stripFileParts<TMessage extends { parts: UIMessage['parts'] }>(
  messages: TMessage[],
): TMessage[] {
  return messages.map((message) => {
    return {
      ...message,
      parts: message.parts.filter((part) => {
        return part.type !== 'file'
      }),
    }
  })
}
