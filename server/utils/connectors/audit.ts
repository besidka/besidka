import { CONNECTOR_AUDIT_ARGS_HKDF_INFO } from '#shared/utils/connectors-policy'
import type {
  ConnectorAuditApproval,
  ConnectorAuditOutcome,
} from '#shared/utils/connectors-policy'
import { recordConnectorToolCall } from '~~/server/utils/connectors/store'
import { canonicalJson } from '~~/server/utils/connectors/tool-definitions'
import { bytesToHex, deriveHkdfBytes } from '~~/server/utils/hkdf'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

const textEncoder = new TextEncoder()

export type ConnectorArgsHasher = (args: unknown) => Promise<string>

/**
 * HMAC-SHA-256 of the canonical JSON arguments, keyed by
 * `HKDF-SHA-256(NUXT_ENCRYPTION_KEY, info='besidka/connector-audit-args/v1')`.
 * A plain hash of short arguments would be reversible by guessing; the keyed
 * digest only lets Besidka tell that two calls had the same arguments. The
 * key is derived on first use and kept for the life of the returned hasher.
 */
export function createConnectorArgsHasher(
  secret: string,
): ConnectorArgsHasher {
  let keyPromise: Promise<CryptoKey> | null = null

  function deriveKey(): Promise<CryptoKey> {
    keyPromise ??= (async () => {
      const keyBytes = await deriveHkdfBytes(
        secret,
        CONNECTOR_AUDIT_ARGS_HKDF_INFO,
      )

      return await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
    })()

    return keyPromise
  }

  return async (args) => {
    const signature = await crypto.subtle.sign(
      'HMAC',
      await deriveKey(),
      textEncoder.encode(canonicalJson(args ?? {})),
    )

    return bytesToHex(new Uint8Array(signature))
  }
}

export interface ConnectorCallAuditInput {
  userId: number
  connectorId: string
  connectorHost: string
  chatPublicId: string
  toolName: string
  args: unknown
  resultBytes: number
  outcome: ConnectorAuditOutcome
  approval: ConnectorAuditApproval
  durationMs: number
}

/**
 * Writes one `connector_tool_calls` row: ids, the tool name, the keyed
 * argument digest, the size, the outcome and the duration, never the
 * arguments or the result, and returns the row id. A failed write is logged
 * by id, returns null and never fails the call.
 */
export async function auditConnectorCall(
  db: DbClient,
  hashArgs: ConnectorArgsHasher,
  input: ConnectorCallAuditInput,
  logger?: LoggerLike,
): Promise<number | null> {
  try {
    return await recordConnectorToolCall(db, {
      userId: input.userId,
      connectorId: input.connectorId,
      connectorHost: input.connectorHost,
      chatPublicId: input.chatPublicId,
      toolName: input.toolName,
      argsHmac: await hashArgs(input.args),
      resultBytes: input.resultBytes,
      outcome: input.outcome,
      approval: input.approval,
      path: 'worker',
      durationMs: input.durationMs,
    })
  } catch {
    logger?.set({
      attributes: {
        connectors: { id: input.connectorId, auditWrite: 'failed' },
      },
    })

    return null
  }
}
