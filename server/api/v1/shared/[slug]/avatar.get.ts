import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { defineEventHandler } from 'nuxt/server'
import { resolveActiveShareBySlug } from '~~/server/utils/chats/share'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import {
  AUTHOR_AVATAR_FETCH_TIMEOUT_MS,
  AUTHOR_AVATAR_MAX_BYTES,
  readCachedAuthorAvatar,
  readLimitedBody,
  resolveAllowedAvatarUrl,
  resolveAvatarMediaType,
  writeCachedAuthorAvatar,
} from '~~/server/utils/shared/author-avatar'

const paramsRules = z.object({
  slug: z.string().nonempty(),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const params = paramsRules.safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
    })
  }

  const share = await resolveActiveShareBySlug(params.data.slug)

  if (!share || !share.showAuthorAvatar) {
    throw createError({
      message: 'Avatar not found',
      status: 404,
    })
  }

  const chat = await useDb().query.chats.findFirst({
    where: { id: share.chatId },
    columns: { id: true },
    with: {
      user: {
        columns: {
          image: true,
        },
      },
    },
  })

  const avatarUrl = resolveAllowedAvatarUrl(chat?.user.image)

  if (!avatarUrl) {
    throw createError({
      message: 'Avatar not found',
      status: 404,
    })
  }

  const cachedAvatar = await readCachedAuthorAvatar(
    event.url.origin,
    avatarUrl,
    logger,
  )

  if (cachedAvatar) {
    applyAvatarResponseHeaders(
      event,
      cachedAvatar.mediaType,
      cachedAvatar.body.byteLength,
    )

    return cachedAvatar.body
  }

  let upstreamResponse: Response

  try {
    upstreamResponse = await fetch(avatarUrl, {
      method: 'GET',
      headers: { accept: 'image/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(AUTHOR_AVATAR_FETCH_TIMEOUT_MS),
    })
  } catch (exception) {
    logger.set({
      sharedAvatar: {
        hostname: avatarUrl.hostname,
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })

    throw createError({
      message: 'Avatar not found',
      status: 404,
    })
  }

  const mediaType = resolveAvatarMediaType(
    upstreamResponse.headers.get('content-type'),
  )

  if (!upstreamResponse.ok || !mediaType) {
    await upstreamResponse.body?.cancel()

    logger.set({
      sharedAvatar: {
        hostname: avatarUrl.hostname,
        status: upstreamResponse.status,
        mediaTypeAccepted: !!mediaType,
      },
    })

    throw createError({
      message: 'Avatar not found',
      status: 404,
    })
  }

  const body = await readLimitedBody(
    upstreamResponse,
    AUTHOR_AVATAR_MAX_BYTES,
  )

  if (!body) {
    logger.set({
      sharedAvatar: {
        hostname: avatarUrl.hostname,
        rejected: 'size',
      },
    })

    throw createError({
      message: 'Avatar not found',
      status: 404,
    })
  }

  await writeCachedAuthorAvatar(
    event.url.origin,
    avatarUrl,
    { body, mediaType },
    logger,
  )

  applyAvatarResponseHeaders(event, mediaType, body.byteLength)

  return body
})

function applyAvatarResponseHeaders(
  event: RequestEvent,
  mediaType: string,
  byteLength: number,
): void {
  applyResponseHeaders(event, {
    'Content-Type': mediaType,
    'Content-Length': byteLength.toString(),
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'default-src \'none\'; sandbox',
  })
}
