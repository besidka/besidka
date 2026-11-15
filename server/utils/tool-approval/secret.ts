import { createError } from 'evlog'
import { TOOL_APPROVAL_SECRET_HKDF_INFO } from '#shared/utils/tool-approval-policy'
import { bytesToHex, deriveHkdfBytes } from '~~/server/utils/hkdf'

interface CachedSecret {
  encryptionKey: string
  secret: Promise<string>
}

let cachedSecret: CachedSecret | null = null

/**
 * The value for the AI SDK's `experimental_toolApprovalSecret`:
 * `HKDF-SHA-256(NUXT_ENCRYPTION_KEY, info='besidka/tool-approval/v1')` as
 * hex. The same key always gives the same secret, so a continuation sent to
 * another Worker instance verifies the signature the first request wrote.
 */
export async function deriveToolApprovalSecret(
  encryptionKey: string,
): Promise<string> {
  return bytesToHex(await deriveHkdfBytes(
    encryptionKey,
    TOOL_APPROVAL_SECRET_HKDF_INFO,
  ))
}

/**
 * Reads the encryption key from the runtime config and derives the approval
 * secret once per key. Throws when the key is missing: without a secret the
 * SDK would run a tampered but schema-valid tool input as sent. A derivation
 * that rejects is dropped from the cache, so the next call tries again
 * instead of failing for the life of the isolate.
 */
export async function useToolApprovalSecret(): Promise<string> {
  const encryptionKey = String(useRuntimeConfig().encryptionKey ?? '')

  if (!encryptionKey) {
    throw createError({
      message: 'Missing tool approval secret',
      status: 500,
      why: 'NUXT_ENCRYPTION_KEY is not configured',
    })
  }

  if (cachedSecret?.encryptionKey !== encryptionKey) {
    cachedSecret = {
      encryptionKey,
      secret: deriveToolApprovalSecret(encryptionKey),
    }
  }

  const cached = cachedSecret

  try {
    return await cached.secret
  } catch (exception) {
    if (cachedSecret === cached) {
      cachedSecret = null
    }

    throw exception
  }
}
