import type { KVNamespace } from '@cloudflare/workers-types'

const GENERATION_IN_PROGRESS_KEY_PREFIX = 'chat-generating'

export function generationInProgressKvKey(
  chatId: string,
  userMessageId: string,
): string {
  return `${GENERATION_IN_PROGRESS_KEY_PREFIX}:${chatId}:${userMessageId}`
}

/**
 * True while any send for the chat holds its generation-in-progress lease.
 * The flag is keyed per user message, so the chat is checked by key prefix.
 * The lease expires on its own when the generating Worker dies, so a stale
 * flag blocks a chat for at most the lease TTL.
 */
export async function isChatGenerating(
  chatId: string,
  kv: Pick<KVNamespace, 'list'> = useKV(),
): Promise<boolean> {
  const result = await kv.list({
    prefix: `${GENERATION_IN_PROGRESS_KEY_PREFIX}:${chatId}:`,
    limit: 1,
  })

  return result.keys.length > 0
}
