import { createError } from 'evlog'

export const CACHE_TTL_DAY = 24 * 60 * 60
export const CACHE_TTL_HOUR = 60 * 60
export const CACHE_TTL_MINUTE = 60

export interface CacheOrFetchOptions<T> {
  key: string
  ttlSeconds: number
  fetcher: () => Promise<T>
  /** If true, ignore cache and always fetch (used by cron refresh). */
  force?: boolean
  /** If the fetcher throws, return this value instead of propagating. */
  fallback?: T
}

export interface CacheOrFetchResult<T> {
  value: T
  source: 'cache' | 'fresh' | 'fallback'
  updatedAt: string
}

interface KvCacheEntry<T> {
  value: T
  updatedAt: string
}

export async function cacheOrFetch<T>(
  options: CacheOrFetchOptions<T>,
): Promise<CacheOrFetchResult<T>> {
  const kv = useKV()

  if (!options.force) {
    try {
      const raw = await kv.get(options.key)

      if (raw !== null) {
        const entry = JSON.parse(raw) as KvCacheEntry<T>

        return {
          value: entry.value,
          source: 'cache',
          updatedAt: entry.updatedAt,
        }
      }
    } catch {
      // Cache miss or parse error — fall through to fetch
    }
  }

  try {
    const value = await options.fetcher()
    const updatedAt = new Date().toISOString()
    const entry: KvCacheEntry<T> = { value, updatedAt }

    await kv.put(options.key, JSON.stringify(entry), {
      expirationTtl: options.ttlSeconds,
    })

    return { value, source: 'fresh', updatedAt }
  } catch (exception) {
    if (options.fallback !== undefined) {
      return {
        value: options.fallback,
        source: 'fallback',
        updatedAt: new Date().toISOString(),
      }
    }

    throw createError({
      message: 'Cache miss and fetch failed',
      status: 502,
      why: exception instanceof Error ? exception.message : String(exception),
      fix: 'Retry; check upstream service health',
    })
  }
}
