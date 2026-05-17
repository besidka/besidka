import type { H3Event } from 'h3'

interface CloudflareRequestProperties {
  colo?: string
  country?: string
  region?: string
  regionCode?: string
  continent?: string
  asn?: number
  timezone?: string
}

interface MutableLogger {
  set: (data: Record<string, unknown>) => void
}

/**
 * Read Cloudflare's `request.cf` properties from an H3 event.
 *
 * The path differs across nitropack versions and presets (cloudflare_module
 * vs cloudflare-pages vs cloudflare_durable). We try each known location.
 */
function readCloudflareProperties(
  event: unknown,
): CloudflareRequestProperties | undefined {
  const eventRecord = event as {
    context?: {
      cloudflare?: { request?: { cf?: CloudflareRequestProperties } }
      cf?: CloudflareRequestProperties
    }
    node?: { req?: { cf?: CloudflareRequestProperties } }
    request?: { cf?: CloudflareRequestProperties }
    web?: { request?: { cf?: CloudflareRequestProperties } }
  }

  return eventRecord.context?.cloudflare?.request?.cf
    || eventRecord.context?.cf
    || eventRecord.web?.request?.cf
    || eventRecord.request?.cf
    || eventRecord.node?.req?.cf
    || undefined
}

/**
 * Read Cloudflare's edge-derived headers as a fallback for properties that
 * `request.cf` may not expose on the current Nitro preset.
 */
function readCloudflareHeaders(event: H3Event): {
  country?: string
  colo?: string
} {
  const country = getHeader(event, 'cf-ipcountry') || undefined
  const cfRayRaw = getHeader(event, 'cf-ray')
  const colo = cfRayRaw && cfRayRaw.includes('-')
    ? cfRayRaw.split('-').pop()
    : undefined

  return { country, colo }
}

/**
 * Attach Cloudflare edge metadata (colo, country, ASN, etc.) to the given
 * logger. Safe to call multiple times — calling `set()` again with the same
 * keys is a no-op on evlog's request loggers.
 *
 * Use this anywhere you create a new request logger (e.g. `createRequestLogger`
 * for AI streaming events) so geographic context is consistent across all
 * wide events tied to a request.
 */
export function attachCloudflareMeta(
  logger: MutableLogger | undefined,
  event: H3Event,
): void {
  if (typeof logger?.set !== 'function') {
    return
  }

  const cf = readCloudflareProperties(event)
  const fallback = readCloudflareHeaders(event)

  const colo = cf?.colo || fallback.colo
  const country = cf?.country || fallback.country

  if (!colo && !country && !cf) {
    return
  }

  logger.set({
    cfColo: colo,
    cfCountry: country,
    cfRegion: cf?.region,
    cfRegionCode: cf?.regionCode,
    cfContinent: cf?.continent,
    cfAsn: cf?.asn,
    cfTimezone: cf?.timezone,
  })
}
