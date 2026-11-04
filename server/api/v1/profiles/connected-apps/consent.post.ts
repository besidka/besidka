import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import {
  defineEventHandler,
  getRequestHeader,
  getRequestURL,
  readValidatedBody,
  sendRedirect,
} from 'nuxt/server'
import { buildApprovedMcpScope } from '#shared/utils/mcp-oauth-scopes'
import { OAUTH_CONSENT_ERROR_PARAM } from '#shared/utils/oauth-consent-errors'
import type { OAuthConsentErrorCode } from '#shared/utils/oauth-consent-errors'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const OAUTH_QUERY_MAX_LENGTH = 8192
const SCOPE_MAX_LENGTH = 64
const SCOPE_MAX_COUNT = 32
const SEE_OTHER = 303
const TOO_MANY_REQUESTS = 429
const FORWARDED_HEADER_NAMES = [
  'cookie',
  'user-agent',
  'cf-connecting-ip',
  'x-forwarded-for',
] as const

const scopeFieldSchema = z.union([
  z.string().max(SCOPE_MAX_LENGTH),
  z.array(z.string().max(SCOPE_MAX_LENGTH)).max(SCOPE_MAX_COUNT),
]).optional()

const consentFormSchema = z.object({
  oauth_query: z.string().min(1).max(OAUTH_QUERY_MAX_LENGTH),
  decision: z.enum(['approve', 'deny']),
  user_id: z.string().min(1).max(32),
  scope: scopeFieldSchema,
})

function toScopeList(scope: string | string[] | undefined): string[] {
  if (!scope) {
    return []
  }

  return Array.isArray(scope) ? scope : [scope]
}

function resolveRequestOrigin(event: RequestEvent): string {
  const origin = getRequestHeader(event, 'origin')

  if (origin) {
    return origin
  }

  const referer = getRequestHeader(event, 'referer')

  if (referer) {
    try {
      return new URL(referer).origin
    } catch {
      return getRequestURL(event).origin
    }
  }

  return getRequestURL(event).origin
}

function buildConsentRequest(
  event: RequestEvent,
  body: Record<string, unknown>,
): Request {
  const headers = new Headers({
    'accept': 'application/json',
    'content-type': 'application/json',
    'origin': resolveRequestOrigin(event),
  })

  for (const name of FORWARDED_HEADER_NAMES) {
    const value = getRequestHeader(event, name)

    if (value) {
      headers.set(name, value)
    }
  }

  return new Request(
    new URL('/api/auth/oauth2/consent', getRequestURL(event).origin),
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
  )
}

function readRedirectUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const { redirect, url } = payload as { redirect?: unknown, url?: unknown }

  if (redirect !== true || typeof url !== 'string' || !url) {
    return null
  }

  return url
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Handles the consent page's native form post, so Approve and Deny work even
 * when the page never hydrated. It forwards the decision to Better Auth's own
 * `/oauth2/consent` endpoint, which keeps its rate limit, origin check and
 * the app's after-hooks, and answers with a 303 to wherever that endpoint
 * sends the user. Every failure returns to the consent page with an error
 * code the page renders.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const form = await readValidatedBody(event, consentFormSchema.safeParse)

  if (form.error) {
    throw createError({
      message: 'This connection request is invalid',
      status: 400,
      why: form.error.message,
      fix: 'Go back to the app you were connecting and start again.',
    })
  }

  const { oauth_query: oauthQuery, decision, user_id: shownUserId } = form.data
  const consentPagePath = `/oauth/consent?${oauthQuery}`

  function returnToConsentPage(code: OAuthConsentErrorCode) {
    logger.set({ attributes: { oauthConsentForm: { decision, error: code } } })

    return sendRedirect(
      event,
      `${consentPagePath}&${OAUTH_CONSENT_ERROR_PARAM}=${code}`,
      SEE_OTHER,
    )
  }

  const session = await useUserSession()

  if (!session) {
    return sendRedirect(event, `/signin?${oauthQuery}`, SEE_OTHER)
  }

  if (String(session.user.id) !== shownUserId) {
    return returnToConsentPage('account_changed')
  }

  const { secret } = await useServerAuth().$context

  if (!await verifyOAuthQueryParams(oauthQuery, secret)) {
    return returnToConsentPage('expired')
  }

  const requestedScopes = new URLSearchParams(oauthQuery)
    .get('scope')
    ?.split(' ')
    .filter(Boolean) ?? []
  const approvedScope = buildApprovedMcpScope(
    requestedScopes,
    toScopeList(form.data.scope),
  )
  const accept = decision === 'approve'

  if (accept && !approvedScope) {
    return returnToConsentPage('nothing_selected')
  }

  let response: Response

  try {
    response = await useServerAuth().handler(buildConsentRequest(event, accept
      ? { accept: true, scope: approvedScope, oauth_query: oauthQuery }
      : { accept: false, oauth_query: oauthQuery }))
  } catch (exception) {
    logger.set({
      attributes: {
        oauthConsentForm: { error: exceptionMessage(exception) },
      },
    })

    return returnToConsentPage('failed')
  }

  const payload = await readJson(response)

  if (response.status === TOO_MANY_REQUESTS) {
    return returnToConsentPage('rate_limited')
  }

  const redirectUrl = response.ok ? readRedirectUrl(payload) : null

  if (!redirectUrl) {
    logger.set({
      attributes: {
        oauthConsentForm: {
          status: response.status,
          body: JSON.stringify(payload)?.slice(0, 300),
        },
      },
    })

    return returnToConsentPage('failed')
  }

  for (const cookie of response.headers.getSetCookie()) {
    event.res.headers.append('set-cookie', cookie)
  }

  logger.set({
    userId: Number(session.user.id),
    attributes: { oauthConsentForm: { decision, status: response.status } },
  })

  return sendRedirect(event, redirectUrl, SEE_OTHER)
})
