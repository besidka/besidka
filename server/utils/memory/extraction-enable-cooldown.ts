import { createError } from 'evlog'
import { MEMORY_EXTRACTION_LIMITS } from '~~/server/utils/memory/extract-limits'

const KV_MINIMUM_TTL_SECONDS = 60

function extractionEnableCooldownKey(userId: number): string {
  return `memory-extraction-enable:${userId}`
}

/**
 * Per-user rate limit for switching automatic memory extraction on, the
 * change that restamps the user's chats. KV expiry has a 60 s floor, so the
 * stamp is a timestamp compared against the cooldown. Answers 429 inside the
 * window and stamps the key otherwise.
 */
export async function claimExtractionEnableCooldown(
  userId: number,
): Promise<void> {
  const kv = useKV()
  const key = extractionEnableCooldownKey(userId)
  const lastAt = Number(await kv.get(key))
  const cooldownMs
    = MEMORY_EXTRACTION_LIMITS.extractionEnableCooldownSeconds * 1000

  if (Number.isFinite(lastAt) && Date.now() - lastAt < cooldownMs) {
    throw createError({
      message: 'Memory updates were turned on moments ago',
      status: 429,
      why: 'Automatic memory updates can be turned back on once every '
        + `${MEMORY_EXTRACTION_LIMITS.extractionEnableCooldownSeconds} seconds.`,
      fix: 'Wait a few seconds, then try again.',
    })
  }

  await kv.put(key, String(Date.now()), {
    expirationTtl: KV_MINIMUM_TTL_SECONDS,
  })
}
