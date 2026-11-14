import type { KVNamespace } from '@cloudflare/workers-types'
import {
  CONNECTOR_OAUTH_STATE_MAX_LENGTH,
  CONNECTOR_OAUTH_STATE_TTL_SECONDS,
} from '#shared/utils/connectors-policy'
import type { ConnectorClientRegistration } from '~~/server/utils/connectors/store'

const STATE_KEY_PREFIX = 'connectors:oauth:'
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export interface ConnectorOAuthState {
  userId: number
  connectorId: string
  codeVerifier: string
  issuer: string
  issParameterRequired: boolean
  resource: string
  requestedScope: string | null
  redirectUri: string
  registration: ConnectorClientRegistration
  createdAt: number
}

function stateKey(state: string): string {
  return `${STATE_KEY_PREFIX}${state}`
}

export function isWellFormedOAuthState(state: unknown): state is string {
  return typeof state === 'string'
    && state.length <= CONNECTOR_OAUTH_STATE_MAX_LENGTH
    && STATE_PATTERN.test(state)
}

/**
 * Stores the pending sign-in under `connectors:oauth:<state>` for ten
 * minutes. The value is encrypted: it holds the PKCE verifier and, for a
 * confidential DCR client, its secret.
 */
export async function saveConnectorOAuthState(
  kv: KVNamespace,
  state: string,
  value: ConnectorOAuthState,
): Promise<void> {
  await kv.put(
    stateKey(state),
    await useEncryptText(JSON.stringify(value)),
    { expirationTtl: CONNECTOR_OAUTH_STATE_TTL_SECONDS },
  )
}

/**
 * Reads and deletes a pending sign-in. The delete happens before the value
 * is used, so a second callback with the same state finds nothing. KV has
 * no atomic read-and-delete, so two callbacks racing in different locations
 * could both read it; the authorization server's single-use code is the
 * backstop. An entry older than the TTL is refused even if KV still has it.
 */
export async function consumeConnectorOAuthState(
  kv: KVNamespace,
  state: string,
  now: number = Date.now(),
): Promise<ConnectorOAuthState | null> {
  if (!isWellFormedOAuthState(state)) {
    return null
  }

  const key = stateKey(state)
  const stored = await kv.get(key)

  if (!stored) {
    return null
  }

  await kv.delete(key)

  let value: ConnectorOAuthState

  try {
    value = JSON.parse(await useDecryptText(stored)) as ConnectorOAuthState
  } catch {
    return null
  }

  const ageMs = now - value.createdAt

  if (
    !Number.isFinite(ageMs)
    || ageMs < 0
    || ageMs > CONNECTOR_OAUTH_STATE_TTL_SECONDS * 1000
  ) {
    return null
  }

  return value
}
