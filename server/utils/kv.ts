import type { KVNamespace } from '@cloudflare/workers-types'
// @ts-ignore
import { env } from 'cloudflare:workers'

export function useKV() {
  const { KV } = env

  if (!KV) {
    throw createError({
      statusCode: 500,
      statusMessage: 'KV binding missing in runtime environment.',
      data: {
        why: 'Cloudflare KV binding `KV` is not available.',
        fix: 'Ensure runtime starts with Wrangler bindings for E2E and CI.',
      },
    })
  }

  return KV as KVNamespace
}
