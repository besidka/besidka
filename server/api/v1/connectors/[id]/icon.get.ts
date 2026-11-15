import { defineEventHandler } from 'nuxt/server'
import { CONNECTOR_ICON_CACHE_SECONDS } from '#shared/utils/connectors-policy'
import { isConnectorConsentCurrent } from '~~/server/utils/connectors/consent'
import { resolveConnectorIcon } from '~~/server/utils/connectors/icon'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const MISS_CACHE_SECONDS = 3600

function buildHeaders(cacheSeconds: number): Record<string, string> {
  return {
    'cache-control': `private, max-age=${cacheSeconds}`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'default-src \'none\'; sandbox',
  }
}

/**
 * The icon of one of the user's connectors, for the reasoning steps. The
 * chat never loads a remote image: this route serves the copy Besidka kept
 * (declared by the server, or its favicon) from the app's own origin. It
 * answers only to the owner, only for a connector with current consent that
 * is connected, and 404s for everything else, a missing icon included, so
 * the client falls back to a letter.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event, {
    write: false,
    rateLimit: false,
  })
  const connector = await requireOwnedConnector(event, userId)
  const isEligible = isConnectorConsentCurrent(connector)
    && (connector.status === 'ready' || connector.status === 'drifted')

  if (!isEligible) {
    return new Response(null, {
      status: 404,
      headers: buildHeaders(MISS_CACHE_SECONDS),
    })
  }

  const image = await resolveConnectorIcon(
    useKV(),
    { id: connector.id, origin: connector.origin },
    { logger: useRequestLogger(event) },
  )

  if (!image) {
    return new Response(null, {
      status: 404,
      headers: buildHeaders(MISS_CACHE_SECONDS),
    })
  }

  return new Response(image.bytes, {
    status: 200,
    headers: {
      ...buildHeaders(CONNECTOR_ICON_CACHE_SECONDS),
      'content-type': image.contentType,
      'content-length': String(image.bytes.byteLength),
    },
  })
})
