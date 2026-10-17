import type { UtmParams } from '#shared/utils/utm'

const AUTH_PATH_PATTERN = /^\/(signup|signin)(?=[/?#]|$)/

export function useUtmAttribution() {
  const route = useRoute()
  const utm = useState<UtmParams>('utm-attribution', () => {
    return {}
  })

  function captureUtmFromQuery(
    query: URLSearchParams | Record<string, unknown> | null | undefined,
  ): void {
    if (hasUtmParams(utm.value)) {
      return
    }

    const capturedUtm = sanitizeUtmParams(query)

    if (!hasUtmParams(capturedUtm)) {
      return
    }

    utm.value = capturedUtm
  }

  function resolveUtm(): UtmParams {
    if (hasUtmParams(utm.value)) {
      return utm.value
    }

    return sanitizeUtmParams(route.query)
  }

  function withUtm(path: string): string {
    return appendUtmToPath(path, utm.value)
  }

  function withAuthUtm(path: string): string {
    if (!AUTH_PATH_PATTERN.test(path)) {
      return path
    }

    return withUtm(path)
  }

  return {
    utm,
    captureUtmFromQuery,
    resolveUtm,
    withUtm,
    withAuthUtm,
  }
}
