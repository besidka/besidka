import { defineEventHandler } from 'nuxt/server'
import { CONNECTOR_CLIENT_METADATA_MAX_AGE_SECONDS } from '#shared/utils/connectors-policy'
import { buildConnectorClientMetadata } from '~~/server/utils/connectors/client-metadata'
import { resolveRequestPublicOrigin } from '~~/server/utils/request-public-origin'

/**
 * Besidka's OAuth Client ID Metadata Document for connectors
 * (docs/connectors.md section 5.3). Public and unauthenticated, because
 * remote authorization servers fetch it. Built from configuration: the
 * configured base URL, or the request host only when it matches the
 * operator's additional-host allowlist (PR previews).
 */
export default defineEventHandler((event) => {
  event.res.headers.set('content-type', 'application/json')
  event.res.headers.set(
    'cache-control',
    `public, max-age=${CONNECTOR_CLIENT_METADATA_MAX_AGE_SECONDS}`,
  )
  event.res.headers.set('x-robots-tag', 'noindex')

  return buildConnectorClientMetadata(resolveRequestPublicOrigin(event))
})
