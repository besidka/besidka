import type { KVNamespace } from '@cloudflare/workers-types'
import {
  CONNECTOR_ICON_MAX_BYTES,
  CONNECTOR_ICON_MAX_DECLARED,
  CONNECTOR_ICON_MISS_TTL_SECONDS,
  CONNECTOR_ICON_SOURCE_MAX_LENGTH,
  CONNECTOR_ICON_TTL_SECONDS,
} from '#shared/utils/connectors-policy'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { safeFetch } from '~~/server/utils/net/safe-fetch'

const ICON_KEY_PREFIX = 'connectors:icon:'
const ICON_SOURCES_KEY_PREFIX = 'connectors:icon-sources:'
const DATA_URI_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i
const FAVICON_PATH = '/favicon.ico'
const EMPTY_VALUE = ''

export const CONNECTOR_ICON_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/x-icon',
] as const

export type ConnectorIconContentType
  = typeof CONNECTOR_ICON_CONTENT_TYPES[number]

export type ConnectorIconOrigin = 'declared' | 'favicon'

export interface ConnectorIconImage {
  bytes: ArrayBuffer
  contentType: ConnectorIconContentType
}

export interface ConnectorIconMetadata {
  contentType?: string
  origin?: ConnectorIconOrigin | 'none'
}

export interface DeclaredConnectorIcon {
  src: string
}

export interface ConnectorIconTarget {
  id: string
  origin: string
}

export interface ConnectorIconDependencies {
  fetchImage?: (
    url: string,
    logger?: LoggerLike,
  ) => Promise<ConnectorIconImage | null>
}

export function connectorIconKey(connectorId: string): string {
  return `${ICON_KEY_PREFIX}${connectorId}`
}

export function connectorIconSourcesKey(connectorId: string): string {
  return `${ICON_SOURCES_KEY_PREFIX}${connectorId}`
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length
    && signature.every((value, index) => bytes[index] === value)
}

function isWebp(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytes.length >= 12
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
}

function isIco(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x00, 0x00, 0x01, 0x00])
    && bytes.length >= 6
    && ((bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8)) > 0
}

/**
 * The image type of a byte string, read from its magic bytes and never from
 * a header or a file name. Only raster formats pass: SVG is refused because
 * it can carry script, and the icon is served from the app's own origin.
 */
export function sniffConnectorIconType(
  bytes: Uint8Array,
): ConnectorIconContentType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) {
    return 'image/png'
  }

  if (startsWith(bytes, [0xFF, 0xD8, 0xFF])) {
    return 'image/jpeg'
  }

  if (
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
    || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return 'image/gif'
  }

  if (isWebp(bytes)) {
    return 'image/webp'
  }

  return isIco(bytes) ? 'image/x-icon' : null
}

export function isConnectorIconContentType(
  value: unknown,
): value is ConnectorIconContentType {
  return typeof value === 'string'
    && (CONNECTOR_ICON_CONTENT_TYPES as readonly string[]).includes(value)
}

function toImage(bytes: Uint8Array): ConnectorIconImage | null {
  if (bytes.byteLength === 0 || bytes.byteLength > CONNECTOR_ICON_MAX_BYTES) {
    return null
  }

  const contentType = sniffConnectorIconType(bytes)

  if (!contentType) {
    return null
  }

  return {
    bytes: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
    contentType,
  }
}

/**
 * The icons a server declared in its `initialize` result (MCP `icons`), as
 * plain sources. Dark-theme icons are dropped because the app shows icons on
 * a light tile, entries without a string `src` are dropped, and at most four
 * are kept.
 */
export function parseDeclaredConnectorIcons(
  serverInfo: unknown,
): DeclaredConnectorIcon[] {
  if (typeof serverInfo !== 'object' || serverInfo === null) {
    return []
  }

  const icons = (serverInfo as { icons?: unknown }).icons

  if (!Array.isArray(icons)) {
    return []
  }

  const declared: DeclaredConnectorIcon[] = []

  for (const icon of icons) {
    if (typeof icon !== 'object' || icon === null) {
      continue
    }

    const { src, theme } = icon as { src?: unknown, theme?: unknown }

    if (
      typeof src !== 'string'
      || src.length === 0
      || src.length > CONNECTOR_ICON_SOURCE_MAX_LENGTH
      || theme === 'dark'
    ) {
      continue
    }

    declared.push({ src })

    if (declared.length >= CONNECTOR_ICON_MAX_DECLARED) {
      break
    }
  }

  return declared
}

/**
 * Remembers the icons a connected server declared, so the icon route can
 * fetch one later without opening a connection. Best effort: a failed write
 * only means the favicon is used.
 */
export async function recordDeclaredConnectorIcons(
  kv: KVNamespace,
  connectorId: string,
  serverInfo: unknown,
): Promise<void> {
  const declared = parseDeclaredConnectorIcons(serverInfo)

  if (declared.length === 0) {
    return
  }

  try {
    await kv.put(
      connectorIconSourcesKey(connectorId),
      JSON.stringify(declared),
      { expirationTtl: CONNECTOR_ICON_TTL_SECONDS },
    )
  } catch {
    return
  }
}

async function readDeclaredConnectorIcons(
  kv: KVNamespace,
  connectorId: string,
): Promise<DeclaredConnectorIcon[]> {
  try {
    const raw = await kv.get(connectorIconSourcesKey(connectorId))

    return raw ? parseDeclaredConnectorIcons({ icons: JSON.parse(raw) }) : []
  } catch {
    return []
  }
}

/**
 * One icon over the network: only through `safeFetch` (https, public hosts,
 * validated redirects, 32 KiB, 5 s), only when the answer is a success, and
 * only when the bytes are a raster image by their magic bytes. Any failure
 * is a miss, never an error.
 */
export async function fetchConnectorIconImage(
  url: string,
  logger?: LoggerLike,
): Promise<ConnectorIconImage | null> {
  try {
    const response = await safeFetch(url, {
      purpose: 'favicon',
      headers: { accept: 'image/png,image/*;q=0.8' },
      logger,
    })

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)

      return null
    }

    return toImage(new Uint8Array(await response.arrayBuffer()))
  } catch {
    return null
  }
}

function decodeDataUriIcon(src: string): ConnectorIconImage | null {
  const match = DATA_URI_PATTERN.exec(src)

  if (!match?.[1]) {
    return null
  }

  try {
    const binary = atob(match[1])

    if (binary.length > CONNECTOR_ICON_MAX_BYTES) {
      return null
    }

    const bytes = new Uint8Array(binary.length)

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return toImage(bytes)
  } catch {
    return null
  }
}

function resolveSameOriginUrl(src: string, origin: string): string | null {
  try {
    const url = new URL(src, origin)

    return url.origin === new URL(origin).origin ? url.toString() : null
  } catch {
    return null
  }
}

async function readStoredIcon(
  kv: KVNamespace,
  connectorId: string,
): Promise<
  | { isStored: false }
  | { isStored: true, image: ConnectorIconImage | null }
> {
  try {
    const { value, metadata } = await kv.getWithMetadata<ConnectorIconMetadata>(
      connectorIconKey(connectorId),
      'arrayBuffer',
    )

    if (value === null) {
      return { isStored: false }
    }

    if (
      metadata?.origin === 'none'
      || !isConnectorIconContentType(metadata?.contentType)
      || value.byteLength === 0
    ) {
      return { isStored: true, image: null }
    }

    return {
      isStored: true,
      image: { bytes: value, contentType: metadata.contentType },
    }
  } catch {
    return { isStored: false }
  }
}

async function storeIcon(
  kv: KVNamespace,
  connectorId: string,
  image: ConnectorIconImage | null,
  origin: ConnectorIconOrigin | null,
): Promise<void> {
  try {
    if (image && origin) {
      await kv.put(connectorIconKey(connectorId), image.bytes, {
        expirationTtl: CONNECTOR_ICON_TTL_SECONDS,
        metadata: {
          contentType: image.contentType,
          origin,
        } satisfies ConnectorIconMetadata,
      })

      return
    }

    await kv.put(connectorIconKey(connectorId), EMPTY_VALUE, {
      expirationTtl: CONNECTOR_ICON_MISS_TTL_SECONDS,
      metadata: { origin: 'none' } satisfies ConnectorIconMetadata,
    })
  } catch {
    return
  }
}

async function fetchDeclaredIcon(
  declared: readonly DeclaredConnectorIcon[],
  origin: string,
  fetchImage: NonNullable<ConnectorIconDependencies['fetchImage']>,
  logger?: LoggerLike,
): Promise<ConnectorIconImage | null> {
  for (const icon of declared) {
    if (icon.src.startsWith('data:')) {
      const image = decodeDataUriIcon(icon.src)

      if (image) {
        return image
      }

      continue
    }

    const url = resolveSameOriginUrl(icon.src, origin)

    if (!url) {
      continue
    }

    const image = await fetchImage(url, logger)

    if (image) {
      return image
    }
  }

  return null
}

/**
 * The icon of one connector, in this order: the copy kept in KV (a miss is
 * kept too, for a day, so a server without an icon is not asked on every
 * render), an icon the server declared (a `data:` image, or a URL on the
 * server's own origin), then the favicon of the server's host. Every fetched
 * image is re-validated by its magic bytes, so what is kept and served is
 * never trusted from a header. Null means no icon: the client shows a letter.
 * Callers gate this on a consented, connected connector.
 */
export async function resolveConnectorIcon(
  kv: KVNamespace,
  connector: ConnectorIconTarget,
  options: {
    logger?: LoggerLike
    dependencies?: ConnectorIconDependencies
  } = {},
): Promise<ConnectorIconImage | null> {
  const stored = await readStoredIcon(kv, connector.id)

  if (stored.isStored) {
    return stored.image
  }

  const fetchImage = options.dependencies?.fetchImage ?? fetchConnectorIconImage
  const declared = await readDeclaredConnectorIcons(kv, connector.id)
  const declaredImage = await fetchDeclaredIcon(
    declared,
    connector.origin,
    fetchImage,
    options.logger,
  )

  if (declaredImage) {
    await storeIcon(kv, connector.id, declaredImage, 'declared')

    return declaredImage
  }

  const faviconUrl = resolveSameOriginUrl(FAVICON_PATH, connector.origin)
  const faviconImage = faviconUrl
    ? await fetchImage(faviconUrl, options.logger)
    : null

  await storeIcon(
    kv,
    connector.id,
    faviconImage,
    faviconImage ? 'favicon' : null,
  )

  return faviconImage
}

export async function deleteConnectorIconCache(
  kv: KVNamespace,
  connectorId: string,
): Promise<void> {
  try {
    await kv.delete(connectorIconKey(connectorId))
    await kv.delete(connectorIconSourcesKey(connectorId))
  } catch {
    return
  }
}
