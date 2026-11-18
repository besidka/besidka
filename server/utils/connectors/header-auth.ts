import { createError } from 'evlog'
import { z } from 'zod'
import {
  CONNECTOR_HEADER_VALUE_MAX_BYTES,
} from '#shared/utils/connectors-policy'
import {
  resolveConnectorHeaderCredential,
} from '#shared/utils/connectors-auth'
import type {
  ConnectorHeaderCredential,
} from '#shared/utils/connectors-auth'
import { isValidConnectorHeader } from '~~/server/utils/connectors/credentials'
import { createConnectorError } from '~~/server/utils/connectors/errors'

const HEADER_NAME_MAX_LENGTH = 64
const textEncoder = new TextEncoder()

export const connectorHeaderAuthSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('bearer'),
    token: z.string().min(1).max(CONNECTOR_HEADER_VALUE_MAX_BYTES),
  }),
  z.object({
    kind: z.literal('header'),
    name: z.string().min(1).max(HEADER_NAME_MAX_LENGTH),
    value: z.string().min(1).max(CONNECTOR_HEADER_VALUE_MAX_BYTES),
  }),
])

export const connectorLegacyHeaderSchema = z.object({
  name: z.string().min(1).max(HEADER_NAME_MAX_LENGTH),
  value: z.string().min(1).max(CONNECTOR_HEADER_VALUE_MAX_BYTES),
})

export interface ConnectorHeaderRequest {
  auth?: z.infer<typeof connectorHeaderAuthSchema>
  header?: z.infer<typeof connectorLegacyHeaderSchema>
}

/**
 * The one header credential a request carries, from the `auth` shape (a
 * bearer token or a custom header) or the older `header` pair that apps and
 * saved clients still send. Sending both is refused. Returns null when the
 * request has no key; throws `CONNECTOR_HEADER_INVALID` for a name or value
 * that section 4.3 rejects. The value is never logged.
 */
export function readConnectorHeaderCredential(
  request: ConnectorHeaderRequest,
): ConnectorHeaderCredential | null {
  if (request.auth && request.header) {
    throw createConnectorError('CONNECTOR_HEADER_INVALID')
  }

  const credential = request.auth
    ? resolveConnectorHeaderCredential(request.auth)
    : request.header ?? null

  if (!request.auth && !request.header) {
    return null
  }

  if (
    request.auth?.kind === 'bearer'
    && credential
    && textEncoder.encode(credential.value).byteLength
    > CONNECTOR_HEADER_VALUE_MAX_BYTES
  ) {
    throw createError({
      message: 'This key is too long',
      status: 400,
      why: 'With "Bearer " added, the header is over 4,096 bytes',
      fix: 'Use a key of at most 4,089 bytes',
    })
  }

  if (
    !credential
    || !isValidConnectorHeader(credential.name, credential.value)
  ) {
    throw createConnectorError('CONNECTOR_HEADER_INVALID')
  }

  return credential
}
