// @ts-ignore
import { env } from 'cloudflare:workers'

export function useFileStorage() {
  const storage = env.R2_BUCKET

  if (!storage) {
    throw createError(`R2 not found in ENV: R2_BUCKET`)
  }

  return storage
}
