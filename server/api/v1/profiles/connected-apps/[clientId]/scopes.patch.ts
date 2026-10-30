import { createError } from 'evlog'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { enforceMemoryRateLimit } from '~~/server/utils/memory/rate-limit'
import {
  SCOPE_ADDITION_REFUSAL,
  narrowConsentScopes,
} from '~~/server/utils/oauth/narrow-consent-scopes'
import { parseStoredOAuthScopes } from '~~/server/utils/oauth/stored-scopes'

const CLIENT_ID_MAX_LENGTH = 256
const SCOPE_MAX_LENGTH = 100
const MAX_KEPT_SCOPES = 50

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const params = z.object({
    clientId: z.string().min(1).max(CLIENT_ID_MAX_LENGTH),
  }).safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const body = await readValidatedBody(event, z.object({
    scopes: z.array(z.string().min(1).max(SCOPE_MAX_LENGTH))
      .max(MAX_KEPT_SCOPES),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const userId = parseInt(session.user.id)
  const { clientId } = params.data

  await enforceMemoryRateLimit('legal-consent', userId, event)

  const db = useDb()
  const consents = await db
    .select({
      id: schema.oauthConsents.id,
      scopes: schema.oauthConsents.scopes,
      updatedAt: schema.oauthConsents.updatedAt,
    })
    .from(schema.oauthConsents)
    .where(and(
      eq(schema.oauthConsents.userId, userId),
      eq(schema.oauthConsents.clientId, clientId),
    ))

  if (!consents.length) {
    throw createError({
      message: 'Connected app not found',
      status: 404,
    })
  }

  const removedScopes = new Set<string>()
  const keptScopes = new Set<string>()
  const pendingUpdates: Array<{
    id: number
    scopes: string[]
    readUpdatedAt: Date
  }> = []

  for (const consent of consents) {
    const narrowed = narrowConsentScopes(
      parseStoredOAuthScopes(consent.scopes),
      body.data.scopes,
    )

    if (narrowed.status === 'addition' || narrowed.status === 'unknown') {
      throw createError({
        message: narrowed.status === 'addition'
          ? SCOPE_ADDITION_REFUSAL
          : 'Unknown permission',
        status: 400,
        why: `${narrowed.status === 'addition'
          ? 'Not granted to this app'
          : 'Not a Besidka permission'}: ${narrowed.scopes.join(' ')}`,
      })
    }

    if (narrowed.status === 'empty') {
      throw createError({
        message: 'This would leave the app with no access at all',
        status: 400,
        fix: 'Disconnect the app instead.',
      })
    }

    narrowed.scopes.forEach((scope) => {
      keptScopes.add(scope)
    })
    narrowed.removedScopes.forEach((scope) => {
      removedScopes.add(scope)
    })

    if (narrowed.removedScopes.length > 0) {
      pendingUpdates.push({
        id: consent.id,
        scopes: narrowed.scopes,
        readUpdatedAt: consent.updatedAt,
      })
    }
  }

  let hasConcurrentChange = false

  try {
    for (const update of pendingUpdates) {
      const updated = await db.update(schema.oauthConsents)
        .set({ scopes: update.scopes })
        .where(and(
          eq(schema.oauthConsents.id, update.id),
          eq(schema.oauthConsents.userId, userId),
          eq(schema.oauthConsents.updatedAt, update.readUpdatedAt),
        ))
        .returning({ id: schema.oauthConsents.id })

      if (updated.length === 0) {
        hasConcurrentChange = true

        break
      }
    }
  } catch (exception) {
    throw createError({
      message: 'Failed to update the app permissions',
      status: 500,
      why: exceptionMessage(exception),
    })
  }

  if (hasConcurrentChange) {
    throw createError({
      message: 'These permissions changed in the meantime. Reload and try again.',
      status: 409,
      why: 'The approval was changed after it was read',
      fix: 'Reload the page and try again.',
    })
  }

  if (pendingUpdates.length > 0) {
    logger.set({
      userId,
      attributes: {
        legalConsent: {
          action: 'oauth_scopes_narrowed',
          oauthClientId: clientId,
          scopes: [...keptScopes],
          removedScopes: [...removedScopes],
        },
      },
    })
  }

  return { clientId, scopes: [...keptScopes] }
})
