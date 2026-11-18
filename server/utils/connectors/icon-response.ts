import { CONNECTOR_ICON_CACHE_SECONDS } from '#shared/utils/connectors-policy'
import type { ConnectorIconImage } from '~~/server/utils/connectors/icon'

export const ICON_MISS_CACHE_SECONDS = 3600
export const ICON_BUSY_CACHE_SECONDS = 5

const SVG_CONTENT_TYPE = 'image/svg+xml'
const DEFAULT_CSP = 'default-src \'none\'; sandbox'
const SVG_CSP = 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox'

function buildHeaders(
  cacheSeconds: number,
  contentSecurityPolicy: string = DEFAULT_CSP,
): Record<string, string> {
  return {
    'cache-control': `private, max-age=${cacheSeconds}`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': contentSecurityPolicy,
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
      ...buildHeaders(
        CONNECTOR_ICON_CACHE_SECONDS,
        image.contentType === SVG_CONTENT_TYPE ? SVG_CSP : DEFAULT_CSP,
      ),
      'content-type': image.contentType,
      'content-length': String(image.bytes.byteLength),
    },
  })
}
