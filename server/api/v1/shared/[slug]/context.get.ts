import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'
import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import type { SharedChatContextResponse } from '#shared/types/chat-context.d'
import * as schema from '~~/server/db/schema'
import { resolveActiveShareBySlug } from '~~/server/utils/chats/share'
import { filterPublicParts } from '~~/server/utils/chats/share-public-parts'
import {
  hideFileParts,
  rewriteShareFileParts,
} from '~~/server/utils/files/rewrite-share-file-urls'
import { buildChatContext } from '~~/server/utils/chats/context/build-chat-context'
import { loadChatContextArtifacts } from '~~/server/utils/chats/context/artifacts'
import { isFeatureGloballyEnabledForEvent } from '~~/server/utils/features/global'
import {
  collectContextModels,
  getContextCost,
  loadChatContextRows,
  toChatContextMessages,
} from '~~/server/utils/chats/context/load-chat-context'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'

const paramsRules = z.object({
  slug: z.string().nonempty(),
})

export default defineEventHandler(async (event) => {
  const params = paramsRules.safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const share = await resolveActiveShareBySlug(params.data.slug)

  if (!share) {
    throw createError({
      message: 'Shared chat not found',
      status: 404,
    })
  }

  const db = useDb()
  const chat = await db.select({
    title: schema.chats.title,
    userId: schema.chats.userId,
  })
    .from(schema.chats)
    .where(eq(schema.chats.id, share.chatId))
    .get()

  if (!chat) {
    throw createError({
      message: 'Shared chat not found',
      status: 404,
    })
  }

  const { rows, truncated } = await loadChatContextRows(db, share.chatId, {
    includeUsage: share.showMetadata === true,
  })
  const publicRows = filterPublicParts(rows.map((row) => {
    return {
      ...row,
      parts: (Array.isArray(row.parts) ? row.parts : []) as UIMessage['parts'],
    }
  }))
  const visibleRows = share.showFiles
    ? await rewriteShareFileParts(publicRows, share.id)
    : hideFileParts(publicRows)
  const messages = toChatContextMessages(visibleRows)
  const artifacts = await isFeatureGloballyEnabledForEvent(event, 'artifacts')
    ? await loadChatContextArtifacts({
      db,
      chatOwnerUserId: chat.userId,
      messages,
      visibility: 'public',
    })
    : undefined
  const context = buildChatContext(messages, {
    visibility: 'public',
    truncated,
    artifacts,
  })
  const response: SharedChatContextResponse = {
    chat: {
      slug: params.data.slug,
      title: chat.title ?? '',
      cost: share.showMetadata ? getContextCost(rows) : null,
      models: share.showMetadata ? collectContextModels(rows) : [],
      allowBranch: share.allowBranch === true,
    },
    ...context,
  }

  return response
})
