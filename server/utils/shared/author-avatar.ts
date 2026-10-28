import type { LoggerLike } from '~~/server/utils/files/logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const AUTHOR_AVATAR_MAX_BYTES = 1024 * 1024
export const AUTHOR_AVATAR_FETCH_TIMEOUT_MS = 5000

const GOOGLE_AVATAR_HOSTNAME_PATTERN = /^lh[0-9]+\.googleusercontent\.com$/
const GOOGLE_AVATAR_PATH_PREFIXES = ['/a/', '/a-/']
const GITHUB_AVATAR_HOSTNAME = 'avatars.githubusercontent.com'
const GITHUB_AVATAR_PATH_PREFIX = '/u/'

const AUTHOR_AVATAR_CACHE_TTL_SECONDS = 3600

const ALLOWED_AVATAR_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

export function resolveAllowedAvatarUrl(
  imageUrl: string | null | undefined,
): URL | null {
  if (!imageUrl) {
    return null
  }

  if (!URL.canParse(imageUrl)) {
    return null
  }

  const url = new URL(imageUrl)

  if (url.protocol !== 'https:' || url.port || url.username || url.password) {
    return null
  }

  const isGoogleAvatar = GOOGLE_AVATAR_HOSTNAME_PATTERN.test(url.hostname)
    && GOOGLE_AVATAR_PATH_PREFIXES.some((prefix) => {
      return url.pathname.startsWith(prefix)
    })
  const isGithubAvatar = url.hostname === GITHUB_AVATAR_HOSTNAME
    && url.pathname.startsWith(GITHUB_AVATAR_PATH_PREFIX)

  return isGoogleAvatar || isGithubAvatar ? url : null
}

export function buildSharedAvatarPath(slug: string): string {
  return `/api/v1/shared/${encodeURIComponent(slug)}/avatar`
}

export function resolveAvatarMediaType(
  contentTypeHeader: string | null,
): string | null {
  const mediaType = contentTypeHeader?.split(';')[0]?.trim().toLowerCase()

  if (!mediaType || !ALLOWED_AVATAR_MEDIA_TYPES.has(mediaType)) {
    return null
  }

  return mediaType
}

export async function readLimitedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declaredLength = Number(response.headers.get('content-length'))

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel()

    return null
  }

  if (!response.body) {
    return null
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    receivedBytes += value.byteLength

    if (receivedBytes > maxBytes) {
      await reader.cancel()

      return null
    }

    chunks.push(value)
  }

  const body = new Uint8Array(receivedBytes)
  let offset = 0

  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return body
}

export interface CachedAuthorAvatar {
  body: Uint8Array
  mediaType: string
}

function resolveEdgeCache(): Cache | null {
  if (typeof caches === 'undefined') {
    return null
  }

  return (caches as unknown as { default: Cache }).default
}

async function buildAvatarCacheRequest(
  origin: string,
  avatarUrl: URL,
): Promise<Request> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(avatarUrl.href),
  )
  const hash = Array.from(new Uint8Array(digest), (byte) => {
    return byte.toString(16).padStart(2, '0')
  }).join('')

  return new Request(`${origin}/api/v1/shared/avatar-cache/${hash}`)
}

export async function readCachedAuthorAvatar(
  origin: string,
  avatarUrl: URL,
  logger: LoggerLike,
): Promise<CachedAuthorAvatar | null> {
  const edgeCache = resolveEdgeCache()

  if (!edgeCache) {
    return null
  }

  try {
    const cachedResponse = await edgeCache.match(
      await buildAvatarCacheRequest(origin, avatarUrl),
    )
    const mediaType = resolveAvatarMediaType(
      cachedResponse?.headers.get('content-type') ?? null,
    )

    if (!cachedResponse || !mediaType) {
      return null
    }

    return {
      body: new Uint8Array(await cachedResponse.arrayBuffer()),
      mediaType,
    }
  } catch (exception) {
    logger.set({
      sharedAvatarCache: {
        operation: 'read',
        error: exceptionMessage(exception),
      },
    })

    return null
  }
}

export async function writeCachedAuthorAvatar(
  origin: string,
  avatarUrl: URL,
  avatar: CachedAuthorAvatar,
  logger: LoggerLike,
): Promise<void> {
  const edgeCache = resolveEdgeCache()

  if (!edgeCache) {
    return
  }

  try {
    await edgeCache.put(
      await buildAvatarCacheRequest(origin, avatarUrl),
      new Response(avatar.body as BodyInit, {
        headers: {
          'Content-Type': avatar.mediaType,
          'Cache-Control': `public, max-age=${AUTHOR_AVATAR_CACHE_TTL_SECONDS}`,
        },
      }),
    )
  } catch (exception) {
    logger.set({
      sharedAvatarCache: {
        operation: 'write',
        error: exceptionMessage(exception),
      },
    })
  }
}
