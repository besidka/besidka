import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { z } from 'zod'
import { GOOGLE_SERVICES } from '#shared/utils/google-tool-catalog'
import type { GoogleService } from '#shared/utils/google-tool-catalog'
import { requireFeature } from '~~/server/utils/features/guards'
import {
  GOOGLE_FEATURE_FLAG,
  requireGoogleAccess,
} from '~~/server/utils/google/route'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'

export type GoogleChatServiceStates = Record<GoogleService, boolean>

function chatNotFoundError() {
  return createError({
    message: 'Chat not found.',
    status: 404,
  })
}

/**
 * The three switches of a chat as booleans, true for a service that is on.
 */
export function toGoogleChatServiceStates(
  servicesOff: readonly GoogleService[],
): GoogleChatServiceStates {
  return Object.fromEntries(GOOGLE_SERVICES.map((service) => {
    return [service, !servicesOff.includes(service)]
  })) as GoogleChatServiceStates
}

/**
 * The gate of the per-chat Google switch routes, in this order: the
 * same-origin guard (the write guard for a `PUT`), a session, the chat,
 * which must belong to the user (a 404 otherwise, also for a malformed
 * slug), the `google.drive` flag active for this user (a 404 otherwise).
 * The write limit of 60 changes a minute is counted by the `PUT` route
 * itself, per user and service, once the body names the service
 * (`enforceGoogleRateLimit`), so two quick switches of different services
 * never share a KV key; it fails closed when KV cannot count. Returns the
 * session user id and the chat's public id; the routes only ever touch that
 * chat's row.
 */
export async function requireGoogleChatToolsAccess(
  event: RequestEvent,
  options: { write: boolean },
): Promise<{ userId: number, chatPublicId: string }> {
  const params = z.object({
    slug: z.ulid(),
  }).safeParse(getDecodedRouterParams(event))
  let chatPublicId = ''
  const userId = await requireGoogleAccess(event, {
    write: options.write,
    rateLimit: 'none',
    feature: false,
    authorize: async (sessionUserId) => {
      if (params.error) {
        throw chatNotFoundError()
      }

      const chat = await useDb().query.chats.findFirst({
        where: { slug: params.data.slug, userId: sessionUserId },
        columns: { id: true },
      })

      if (!chat) {
        throw chatNotFoundError()
      }

      chatPublicId = chat.id

      await requireFeature(event, GOOGLE_FEATURE_FLAG)
    },
  })

  return { userId, chatPublicId }
}
