import type { UtmParams } from '#shared/utils/utm'

export const UTM_BLOB_FALLBACK = 'none'

export function toUtmBlobs(
  utm: UtmParams | null | undefined,
): [string, string, string, string] {
  return [
    utm?.campaign || UTM_BLOB_FALLBACK,
    utm?.source || UTM_BLOB_FALLBACK,
    utm?.medium || UTM_BLOB_FALLBACK,
    utm?.content || UTM_BLOB_FALLBACK,
  ]
}
