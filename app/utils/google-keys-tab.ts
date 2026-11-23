export interface GoogleKeysTabInput {
  isConnectorsActive: boolean
  isDriveActive: boolean
  hasConnection: boolean
  hasByoStatus: boolean
}

/**
 * Whether the API Keys page shows its Google tab. With the Connectors page,
 * the tab only holds the owner's own OAuth client, so it shows exactly when
 * the status has an own-client part. Without that page there is nowhere
 * else to connect Google Drive, so the tab also shows while `google.drive`
 * is active or a connection is left over.
 */
export function isGoogleTabVisible(input: GoogleKeysTabInput): boolean {
  if (input.hasByoStatus) {
    return true
  }

  return !input.isConnectorsActive
    && (input.isDriveActive || input.hasConnection)
}
