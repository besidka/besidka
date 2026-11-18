interface ConnectedStateInput {
  status: string
  lastConnectedAt: Date | string | null
  consentedAt: Date | string | null
}

/**
 * Whether a connector row was never connected: it has no sign-in or key
 * that a server ever answered with (`lastConnectedAt` is never set) and it
 * is either still waiting for a sign-in or has no consent. Such a row is a
 * leftover of the old add-then-connect flow or a connector that an app added
 * over MCP; the app creates a row only after a connect succeeded, so a row
 * like this is never counted as added or turned on.
 */
export function isConnectorNeverConnected(
  connector: ConnectedStateInput,
): boolean {
  return !connector.lastConnectedAt
    && (connector.status === 'needs-auth' || !connector.consentedAt)
}
