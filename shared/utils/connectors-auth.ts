export const CONNECTOR_BEARER_HEADER_NAME = 'Authorization'

export const CONNECTOR_HEADER_AUTH_KINDS = ['bearer', 'header'] as const

export type ConnectorHeaderAuthKind
  = typeof CONNECTOR_HEADER_AUTH_KINDS[number]

export interface ConnectorHeaderCredential {
  name: string
  value: string
}

export type ConnectorHeaderAuthInput
  = | { kind: 'bearer', token: string }
    | { kind: 'header', name: string, value: string }

export interface ConnectorHeaderAuthDefault {
  kind: ConnectorHeaderAuthKind
  name: string
}

const BEARER_PREFIX_PATTERN = /^bearer(?:\s+|$)/i

/**
 * Removes the leading `Bearer ` a user pasted together with the token, in any
 * letter case and any number of times, so the scheme is never doubled.
 */
export function stripBearerPrefix(token: string): string {
  let stripped = token.trim()

  while (BEARER_PREFIX_PATTERN.test(stripped)) {
    stripped = stripped.replace(BEARER_PREFIX_PATTERN, '').trimStart()
  }

  return stripped
}

/**
 * The one header a connector request carries, built from either request
 * shape. A bearer token becomes `Authorization: Bearer <token>`; a custom
 * header is sent exactly as typed apart from the name's surrounding spaces.
 * Returns null for a token that is empty once the prefix is stripped.
 */
export function resolveConnectorHeaderCredential(
  auth: ConnectorHeaderAuthInput,
): ConnectorHeaderCredential | null {
  if (auth.kind === 'bearer') {
    const token = stripBearerPrefix(auth.token)

    if (!token) {
      return null
    }

    return {
      name: CONNECTOR_BEARER_HEADER_NAME,
      value: `Bearer ${token}`,
    }
  }

  return { name: auth.name.trim(), value: auth.value }
}

/**
 * Which way the key form opens: "API key or token" unless the server names a
 * header other than Authorization, in which case "Custom header" with that
 * name filled in. Header names only, never values.
 */
export function resolveHeaderAuthDefault(
  declaredNames: readonly string[],
): ConnectorHeaderAuthDefault {
  const isAuthorizationDeclared = declaredNames.some((name) => {
    return name.toLowerCase() === CONNECTOR_BEARER_HEADER_NAME.toLowerCase()
  })
  const [firstName] = declaredNames

  if (isAuthorizationDeclared || !firstName) {
    return { kind: 'bearer', name: CONNECTOR_BEARER_HEADER_NAME }
  }

  return { kind: 'header', name: firstName }
}
