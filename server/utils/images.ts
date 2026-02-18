import type { ImagesBinding } from '@cloudflare/workers-types'
// @ts-ignore
import { env } from 'cloudflare:workers'

export function useImageTransform(): ImagesBinding {
  const image = env.IMAGES

  if (!image) {
    throw createError('IMAGES not found in ENV: IMAGES')
  }

  return image
}
