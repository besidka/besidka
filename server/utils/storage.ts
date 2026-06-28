// @ts-ignore
import { env } from 'cloudflare:workers'

export function useFileStorage() {
  const storage = env.DATA_BUCKET

  if (!storage) {
    throw createError(`R2 not found in ENV: DATA_BUCKET`)
  }

  return storage
}
