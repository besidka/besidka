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
const FORM_BODY_MAX_BYTES = 16 * 1024
const SCOPE_MAX_LENGTH = 64
const SCOPE_MAX_COUNT = 32
const PRINTABLE_QUERY_PATTERN = /^[\x21-\x7E]+$/
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
  oauth_query: z.string()
    .min(1)
    .max(OAUTH_QUERY_MAX_LENGTH)
    .regex(PRINTABLE_QUERY_PATTERN),
  decision: z.enum(['approve', 'deny', 'none']),
  user_id: z.string().min(1).max(32),
  scope: scopeFieldSchema,
})

function toScopeList(scope: string | string[] | undefined): string[] {
  if (!scope) {
    return []
  }

  return Array.isArray(scope) ? scope : [scope]
}

function assertFormBodyWithinLimit(event: RequestEvent): void {
  const contentLength = Number(getRequestHeader(event, 'content-length'))

  if (Number.isFinite(contentLength) && contentLength > FORM_BODY_MAX_BYTES) {
    throw createError({
      message: 'This connection request is too large',
      status: 413,
      why: `Body of ${contentLength} bytes exceeds ${FORM_BODY_MAX_BYTES}`,
    })
  }
}

function assertSameOriginFormPost(event: RequestEvent): string {
  const origin = getRequestHeader(event, 'origin')
  const requestOrigin = getRequestURL(event).origin

  if (origin !== requestOrigin) {
    throw createError({
      message: 'Forbidden',
      status: 403,
      why: `Origin "${origin ?? 'missing'}" is not ${requestOrigin}`,
      fix: 'Approve or deny the request from the Besidka consent page.',
    })
  }

  return origin
}

function buildConsentRequest(
  event: RequestEvent,
  origin: string,
  body: Record<string, unknown>,
): Request {
  const headers = new Headers({
    'accept': 'application/json',
    'content-type': 'application/json',
    origin,
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

  const origin = assertSameOriginFormPost(event)

  assertFormBodyWithinLimit(event)

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

  function returnToConsentPage(
    code: OAuthConsentErrorCode,
    consentQuery: string = oauthQuery,
  ) {
    logger.set({ attributes: { oauthConsentForm: { decision, error: code } } })

    const errorQuery = `${OAUTH_CONSENT_ERROR_PARAM}=${code}`

    return sendRedirect(
      event,
      consentQuery
        ? `/oauth/consent?${consentQuery}&${errorQuery}`
        : `/oauth/consent?${errorQuery}`,
      SEE_OTHER,
    )
  }

  const { secret } = await useServerAuth().$context

  if (!await verifyOAuthQueryParams(oauthQuery, secret)) {
    return returnToConsentPage('expired', '')
  }

  if (decision === 'none') {
    return sendRedirect(event, `/oauth/consent?${oauthQuery}`, SEE_OTHER)
  }

  const session = await useUserSession()

  if (!session) {
    return sendRedirect(event, `/signin?${oauthQuery}`, SEE_OTHER)
  }

  if (String(session.user.id) !== shownUserId) {
    return returnToConsentPage('account_changed')
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
    response = await useServerAuth().handler(buildConsentRequest(
      event,
      origin,
      accept
        ? { accept: true, scope: approvedScope, oauth_query: oauthQuery }
        : { accept: false, oauth_query: oauthQuery },
    ))
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
