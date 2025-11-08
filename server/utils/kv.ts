import type { H3Event } from 'h3'
import type { KVNamespace } from '@cloudflare/workers-types'

export function useKV(event?: H3Event) {
  event = event ?? useEvent()

  if (!event.context?.cloudflare?.env) {
    throw createError('Cloudflare environment not found in event context')
  }

  const { KV } = event.context.cloudflare.env

  if (!KV) {
    throw createError(`KV not found in ENV: KV`)
  }

  return KV as KVNamespace
}
