import type { UIMessage } from 'ai'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import { isToolUIPart } from 'ai'
import { createError } from 'evlog'
import { resolveActiveShareBySlug } from '~~/server/utils/chats/share'
import {
  rewriteShareFileParts,
  stripFileParts,
} from '~~/server/utils/files/rewrite-share-file-urls'

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
      user: {
        columns: {
          name: true,
          image: true,
        },
      },
      messages: {
        columns: {
          id: true,
          publicId: true,
          role: true,
          parts: true,
          reasoning: true,
          researchDepth: true,
          createdAt: true,
          usage: true,
        },
        orderBy: { createdAt: 'asc' },
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
        researchDepth: message.researchDepth,
        createdAt: message.createdAt,
        usage: message.usage,
      }
    })

  const publicMessages = filterPublicParts(persistedMessages)

  const messagesWithResolvedFiles = share.showFiles
    ? await rewriteShareFileParts(publicMessages, share.id, event)
    : stripFileParts(publicMessages)

  const messages = messagesWithResolvedFiles.map((message) => {
    return {
      id: message.id,
      role: message.role,
      parts: message.parts,
      reasoning: message.reasoning,
      researchDepth: message.researchDepth,
      ...(share.showMetadata
        ? {
          createdAt: message.createdAt,
          usage: message.usage ?? undefined,
        }
        : {}),
    }
  })

  const author = share.showAuthorAvatar
    ? { name: chat.user.name, image: chat.user.image }
    : null

  return {
    title: chat.title,
    indexable: share.indexable,
    showFiles: share.showFiles,
    showMetadata: share.showMetadata,
    showAuthorAvatar: share.showAuthorAvatar,
    allowBranch: share.allowBranch,
    author,
    messages,
  }
})

function filterPublicParts<TMessage extends { parts: UIMessage['parts'] }>(
  messages: TMessage[],
): TMessage[] {
  return messages.map((message) => {
    return {
      ...message,
      parts: message.parts.filter((part) => {
        return !isToolUIPart(part)
      }),
    }
  })
}
