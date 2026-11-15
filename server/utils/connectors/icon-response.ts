import { CONNECTOR_ICON_CACHE_SECONDS } from '#shared/utils/connectors-policy'
import type { ConnectorIconImage } from '~~/server/utils/connectors/icon'

export const ICON_MISS_CACHE_SECONDS = 3600
export const ICON_BUSY_CACHE_SECONDS = 5

function buildHeaders(cacheSeconds: number): Record<string, string> {
  return {
    'cache-control': `private, max-age=${cacheSeconds}`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'default-src \'none\'; sandbox',
    'cross-origin-resource-policy': 'same-origin',
  }
}

export function iconMissResponse(
  cacheSeconds: number = ICON_MISS_CACHE_SECONDS,
): Response {
  return new Response(null, {
    status: 404,
    headers: buildHeaders(cacheSeconds),
  })
}

export function iconImageResponse(image: ConnectorIconImage): Response {
  return new Response(image.bytes, {
    status: 200,
    headers: {
      ...buildHeaders(CONNECTOR_ICON_CACHE_SECONDS),
      'content-type': image.contentType,
      'content-length': String(image.bytes.byteLength),
    },
  })
}
