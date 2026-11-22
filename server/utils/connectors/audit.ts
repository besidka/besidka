import { CONNECTOR_AUDIT_ARGS_HKDF_INFO } from '#shared/utils/connectors-policy'
import type {
  ConnectorAuditApproval,
  ConnectorAuditOutcome,
} from '#shared/utils/connectors-policy'
import {
  recordConnectorToolCall,
  settleConnectorToolCall,
} from '~~/server/utils/connectors/store'
import { canonicalJson } from '~~/server/utils/connectors/tool-definitions'
import { bytesToHex, deriveHkdfBytes } from '~~/server/utils/hkdf'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

const textEncoder = new TextEncoder()

export type ConnectorArgsHasher = (args: unknown) => Promise<string>

const BIDI_FORMATTING_CODE_POINTS = new Set<number>([
  0x061C,
  0x200E,
  0x200F,
  0x202A,
  0x202B,
  0x202C,
  0x202D,
  0x202E,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
])

function isUnsafeAuditCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1F
    || (codePoint >= 0x7F && codePoint <= 0x9F)
    || BIDI_FORMATTING_CODE_POINTS.has(codePoint)
}

/**
 * A remote tool name with control and bidirectional formatting characters
 * removed, so an audit row cannot hide or reorder what it shows.
 */
export function toAuditToolName(toolName: string): string {
  return stripControlAndBidiCharacters(toolName)
}

/**
 * The text with C0 and C1 control characters and bidirectional formatting
 * characters removed.
 */
export function stripControlAndBidiCharacters(text: string): string {
  return [...text].filter((character) => {
    return !isUnsafeAuditCodePoint(character.codePointAt(0) ?? 0)
  }).join('')
}

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
      toolName: toAuditToolName(input.toolName),
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

export interface ConnectorCallSettlement {
  outcome: ConnectorAuditOutcome
  approval: ConnectorAuditApproval
  resultBytes: number
  durationMs: number
}

/**
 * Settles the `pending` audit row a paused call left behind with what really
 * happened once the user answered, instead of writing a second row. A failed
 * write is logged and never fails the call.
 */
export async function settleConnectorAuditRow(
  db: DbClient,
  userId: number,
  auditCallId: number,
  settlement: ConnectorCallSettlement,
  logger?: LoggerLike,
): Promise<void> {
  try {
    await settleConnectorToolCall(db, userId, auditCallId, settlement)
  } catch {
    logger?.set({
      attributes: {
        connectors: { auditSettle: 'failed' },
      },
    })
  }
}
