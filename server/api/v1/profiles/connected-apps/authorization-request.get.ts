import { createError } from 'evlog'
import { eq } from 'drizzle-orm'
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import * as schema from '~~/server/db/schema'
import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { parseStoredOAuthScopes } from '~~/server/utils/oauth/stored-scopes'

const OAUTH_QUERY_MAX_LENGTH = 8192

function resolveRedirectHost(redirectUri: string): string | null {
  try {
    const url = new URL(redirectUri)

    return url.host || `${url.protocol}//`
  } catch {
    return null
  }
}

function resolveHttpsUrl(value: string | null): string | null {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value)

    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function invalidRequestError(why: string) {
  return createError({
    message: 'This connection request is invalid or has expired',
    status: 400,
    why,
    fix: 'Go back to the app you were connecting and start again.',
  })
}

export default defineEventHandler(async (event) => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const query = await getValidatedQuery(event, z.object({
    oauth_query: z.string().min(1).max(OAUTH_QUERY_MAX_LENGTH),
  }).safeParse)

  if (query.error) {
    throw invalidRequestError(query.error.message)
  }

  const oauthQuery = query.data.oauth_query
  const { secret } = await useServerAuth().$context

  if (!await verifyOAuthQueryParams(oauthQuery, secret)) {
    throw invalidRequestError('The signed OAuth query failed verification')
  }

  const params = new URLSearchParams(oauthQuery)
  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')

  if (!clientId || !redirectUri) {
    throw invalidRequestError('client_id or redirect_uri is missing')
  }

  const db = useDb()
  const [client] = await db
    .select({
      clientId: schema.oauthClients.clientId,
      name: schema.oauthClients.name,
      uri: schema.oauthClients.uri,
      disabled: schema.oauthClients.disabled,
      scopes: schema.oauthClients.scopes,
    })
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.clientId, clientId))
    .limit(1)

  if (!client || client.disabled) {
    throw invalidRequestError('The OAuth client does not exist or is disabled')
  }

  const requestedScopes = params.get('scope')?.split(' ').filter(Boolean)
    ?? parseStoredOAuthScopes(client.scopes)

  return {
    client: {
      clientId: client.clientId,
      name: client.name || 'Unnamed app',
      uri: resolveHttpsUrl(client.uri),
    },
    redirectHost: resolveRedirectHost(redirectUri),
    scopes: [...new Set(requestedScopes)],
    expiresAt: new Date(Number(params.get('exp')) * 1000).toISOString(),
  }
})
