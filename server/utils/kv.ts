import type { KVNamespace } from '@cloudflare/workers-types'

export function useKV(): KVNamespace {
  const kv = (globalThis as any).__env__.KV

  if (!kv) {
    throw createError(`KV not found in ENV: ${name}`)
  }

  return kv
}
