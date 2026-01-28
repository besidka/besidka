import type { KVNamespace } from '@cloudflare/workers-types'
import { env } from 'cloudflare:workers'

export function useKV() {
  const { KV } = env

  if (!KV) {
    throw createError(`KV not found in ENV: KV`)
  }

  return KV as KVNamespace
}
