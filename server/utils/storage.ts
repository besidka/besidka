import type { R2Bucket } from '@cloudflare/workers-types'
// @ts-ignore
import { env } from 'cloudflare:workers'

export function useFileStorage(): R2Bucket {
  const storage = env.R2_BUCKET

  if (!storage) {
    throw createError(`R2 not found in ENV: R2_BUCKET`)
  }

  return storage
}
