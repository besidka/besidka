import { createError } from 'evlog'
import { getGrantedCapabilities } from '#shared/utils/google-connections'
import type { GoogleConnectionStatus } from '#shared/utils/google-connections'
import { GOOGLE_CLIENT_MODES } from '#shared/utils/google-scopes'
import type {
  GoogleCapability,
  GoogleClientMode,
} from '#shared/utils/google-scopes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { isGoogleByoAllowed } from '~~/server/utils/google/byo-access'
import { disconnectGoogleConnection } from '~~/server/utils/google/connection'
import { readGoogleConnection } from '~~/server/utils/google/store'
import type { GoogleConnectionRecord } from '~~/server/utils/google/store'

type DbClient = ReturnType<typeof useDb>

export const MCP_GOOGLE_CLIENT_MODES = GOOGLE_CLIENT_MODES

export interface McpGoogleContext {
  db: DbClient
  userId: number
  logger: LoggerLike
}

export interface McpGoogleConnection {
  clientMode: GoogleClientMode
  connected: boolean
  status: Exclude<GoogleConnectionStatus, 'revoked'> | null
  capabilities: GoogleCapability[]
  connectedAt: string | null
}

export interface McpGoogleDisconnectResult {
  disconnected: true
  revoked: boolean
  filesDeleted: number
  filesPending: boolean
}

function toNotConnected(clientMode: GoogleClientMode): McpGoogleConnection {
  return {
    clientMode,
    connected: false,
    status: null,
    capabilities: [],
    connectedAt: null,
  }
}

function toConnection(record: GoogleConnectionRecord): McpGoogleConnection {
  if (record.status === 'revoked') {
    return toNotConnected(record.clientMode)
  }

  return {
    clientMode: record.clientMode,
    connected: true,
    status: record.status,
    capabilities: record.status === 'active'
      ? getGrantedCapabilities(record.grantedScopes)
      : [],
    connectedAt: record.createdAt.toISOString(),
  }
}

async function canSeeByoMode(context: McpGoogleContext): Promise<boolean> {
  try {
    return await isGoogleByoAllowed({
      db: context.db,
      userId: context.userId,
      logger: context.logger,
    })
  } catch (exception) {
    context.logger.set({
      attributes: {
        google: {
          byoGate: 'unavailable',
          byoGateError: exception instanceof Error
            ? exception.name
            : 'unknown',
        },
      },
    })

    return false
  }
}

/**
 * The status of the user's Google connections, one entry per client mode,
 * built field by field so the Google account's email and subject, the
 * connection id and everything stored for tokens or the client can never
 * reach the result. Besidka's mode is always listed. The owner's own client
 * is listed only for a caller who passes the same admin and `google.byo`
 * gate as the app, and a gate that cannot be checked hides it; no other
 * caller can tell that the mode exists. A `revoked` row (a disconnect whose
 * cleanup is still running) reads as not connected.
 */
export async function listMcpGoogleConnections(
  context: McpGoogleContext,
): Promise<{ connections: McpGoogleConnection[] }> {
  const modes: GoogleClientMode[] = (await canSeeByoMode(context))
    ? [...MCP_GOOGLE_CLIENT_MODES]
    : ['besidka']
  const connections: McpGoogleConnection[] = []

  for (const clientMode of modes) {
    const record = await readGoogleConnection(
      context.db,
      context.userId,
      clientMode,
    )

    connections.push(record ? toConnection(record) : toNotConnected(clientMode))
  }

  return { connections }
}

/**
 * Disconnects one client mode through the function the app's disconnect
 * route calls, so the revoke at Google, the cleanup of the copies and the
 * logging are identical. Like the route it needs no flag and no admin role:
 * ending access only ever removes it, so a former admin can still end the
 * owner's own connection. A mode with nothing to disconnect, including the
 * owner's mode for a caller who never had it, answers the same 404.
 */
export async function disconnectMcpGoogle(
  context: McpGoogleContext,
  input: { clientMode: GoogleClientMode },
): Promise<McpGoogleDisconnectResult> {
  const result = await disconnectGoogleConnection({
    db: context.db,
    userId: context.userId,
    clientMode: input.clientMode,
    logger: context.logger,
  })

  if (!result.disconnected) {
    throw createError({
      status: 404,
      message: 'Google is not connected for this client mode. Use '
        + 'list_google_connections to see what is connected.',
    })
  }

  return {
    disconnected: true,
    revoked: result.revoked,
    filesDeleted: result.filesDeleted,
    filesPending: result.filesPending,
  }
}
