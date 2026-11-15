import type { KVNamespace } from '@cloudflare/workers-types'
import {
  CONNECTOR_ICON_LOCK_TTL_SECONDS,
  CONNECTOR_ICON_MAX_BYTES,
  CONNECTOR_ICON_MAX_DECLARED,
  CONNECTOR_ICON_MAX_DIMENSION,
  CONNECTOR_ICON_MISS_TTL_SECONDS,
  CONNECTOR_ICON_SOURCE_MAX_LENGTH,
  CONNECTOR_ICON_TTL_SECONDS,
} from '#shared/utils/connectors-policy'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { safeFetch } from '~~/server/utils/net/safe-fetch'

const ICON_KEY_PREFIX = 'connectors:icon:'
const ICON_SOURCES_KEY_PREFIX = 'connectors:icon-sources:'
const ICON_LOCK_KEY_PREFIX = 'connectors:icon-lock:'
const LOCK_MARKER = '1'
const DATA_URI_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i
const FAVICON_PATH = '/favicon.ico'
const MISS_MARKER = '-'

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

export function connectorIconLockKey(connectorId: string): string {
  return `${ICON_LOCK_KEY_PREFIX}${connectorId}`
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

export interface ConnectorIconDimensions {
  width: number
  height: number
}

function readUint16(bytes: Uint8Array, offset: number, isLittle: boolean) {
  const first = bytes[offset] ?? 0
  const second = bytes[offset + 1] ?? 0

  return isLittle ? first | (second << 8) : (first << 8) | second
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) * 0x1000000)
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0)
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0)
    | ((bytes[offset + 1] ?? 0) << 8)
    | ((bytes[offset + 2] ?? 0) << 16)
}

function readPngDimensions(bytes: Uint8Array) {
  const isHeaderChunk = bytes.length >= 24
    && bytes[12] === 0x49
    && bytes[13] === 0x48
    && bytes[14] === 0x44
    && bytes[15] === 0x52

  return isHeaderChunk
    ? {
      width: readUint32BigEndian(bytes, 16),
      height: readUint32BigEndian(bytes, 20),
    }
    : null
}

function readGifDimensions(bytes: Uint8Array) {
  return bytes.length >= 10
    ? { width: readUint16(bytes, 6, true), height: readUint16(bytes, 8, true) }
    : null
}

function readWebpDimensions(bytes: Uint8Array) {
  const chunk = String.fromCharCode(
    bytes[12] ?? 0,
    bytes[13] ?? 0,
    bytes[14] ?? 0,
    bytes[15] ?? 0,
  )

  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return {
      width: readUint16(bytes, 26, true) & 0x3FFF,
      height: readUint16(bytes, 28, true) & 0x3FFF,
    }
  }

  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2F) {
    const bits = (bytes[21] ?? 0)
      | ((bytes[22] ?? 0) << 8)
      | ((bytes[23] ?? 0) << 16)
      | ((bytes[24] ?? 0) * 0x1000000)

    return {
      width: (bits & 0x3FFF) + 1,
      height: ((bits >>> 14) & 0x3FFF) + 1,
    }
  }

  if (chunk === 'VP8X' && bytes.length >= 30) {
    return {
      width: readUint24LittleEndian(bytes, 24) + 1,
      height: readUint24LittleEndian(bytes, 27) + 1,
    }
  }

  return null
}

function isJpegFrameMarker(marker: number): boolean {
  return marker >= 0xC0
    && marker <= 0xCF
    && marker !== 0xC4
    && marker !== 0xC8
    && marker !== 0xCC
}

function readJpegDimensions(bytes: Uint8Array) {
  let offset = 2

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xFF) {
      return null
    }

    const marker = bytes[offset + 1] ?? 0

    if (marker === 0xFF) {
      offset += 1

      continue
    }

    if (isJpegFrameMarker(marker)) {
      return {
        height: readUint16(bytes, offset + 5, false),
        width: readUint16(bytes, offset + 7, false),
      }
    }

    offset += 2 + readUint16(bytes, offset + 2, false)
  }

  return null
}

function readIcoDimensions(bytes: Uint8Array) {
  const count = readUint16(bytes, 4, true)
  const directoryEnd = 6 + count * 16

  if (count === 0 || directoryEnd > bytes.length) {
    return null
  }

  let width = 0
  let height = 0

  for (let entry = 0; entry < count; entry += 1) {
    const base = 6 + entry * 16
    const size = readUint32LittleEndian(bytes, base + 8)
    const offset = readUint32LittleEndian(bytes, base + 12)

    if (offset < directoryEnd || offset + size > bytes.length) {
      return null
    }

    width = Math.max(width, bytes[base] || 256)
    height = Math.max(height, bytes[base + 1] || 256)
  }

  return { width, height }
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0)
    + ((bytes[offset + 1] ?? 0) << 8)
    + ((bytes[offset + 2] ?? 0) << 16)
    + ((bytes[offset + 3] ?? 0) * 0x1000000)
}

/**
 * The pixel size an image declares in its own header, or null when the
 * header cannot be read. An ICO reports its largest entry and is refused when
 * a directory entry points outside the file.
 */
export function readConnectorIconDimensions(
  bytes: Uint8Array,
  contentType: ConnectorIconContentType,
): ConnectorIconDimensions | null {
  switch (contentType) {
    case 'image/png':
      return readPngDimensions(bytes)
    case 'image/gif':
      return readGifDimensions(bytes)
    case 'image/webp':
      return readWebpDimensions(bytes)
    case 'image/jpeg':
      return readJpegDimensions(bytes)
    case 'image/x-icon':
      return readIcoDimensions(bytes)
  }
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

  const dimensions = readConnectorIconDimensions(bytes, contentType)

  if (
    !dimensions
    || dimensions.width < 1
    || dimensions.height < 1
    || dimensions.width > CONNECTOR_ICON_MAX_DIMENSION
    || dimensions.height > CONNECTOR_ICON_MAX_DIMENSION
  ) {
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
 * fetch one later without opening a connection. When the sources are new or
 * changed, the kept icon (a favicon, or a miss) is dropped so the declared
 * icon wins on the next render. Best effort: a failed write only means the
 * favicon is used.
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

  const serialized = JSON.stringify(declared)

  try {
    const stored = await kv.get(connectorIconSourcesKey(connectorId))

    if (stored === serialized) {
      return
    }

    await kv.put(connectorIconSourcesKey(connectorId), serialized, {
      expirationTtl: CONNECTOR_ICON_TTL_SECONDS,
    })
    await kv.delete(connectorIconKey(connectorId))
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

    if (metadata?.origin === 'none') {
      return { isStored: true, image: null }
    }

    if (value === null) {
      return { isStored: false }
    }

    if (
      !isConnectorIconContentType(metadata?.contentType)
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

    await kv.put(connectorIconKey(connectorId), MISS_MARKER, {
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

export const CONNECTOR_ICON_BUSY = 'busy'

async function acquireIconLock(
  kv: KVNamespace,
  connectorId: string,
): Promise<boolean> {
  try {
    if (await kv.get(connectorIconLockKey(connectorId))) {
      return false
    }

    await kv.put(connectorIconLockKey(connectorId), LOCK_MARKER, {
      expirationTtl: CONNECTOR_ICON_LOCK_TTL_SECONDS,
    })
  } catch {
    return true
  }

  return true
}

async function releaseIconLock(
  kv: KVNamespace,
  connectorId: string,
): Promise<void> {
  try {
    await kv.delete(connectorIconLockKey(connectorId))
  } catch {
    return
  }
}

async function fetchAndStoreIcon(
  kv: KVNamespace,
  connector: ConnectorIconTarget,
  options: {
    logger?: LoggerLike
    dependencies?: ConnectorIconDependencies
  },
): Promise<ConnectorIconImage | null> {
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

/**
 * The icon of one connector, in this order: the copy kept in KV (a miss is
 * kept too, for a day, so a server without an icon is not asked on every
 * render), an icon the server declared (a `data:` image, or a URL on the
 * server's own origin), then the favicon of the server's host. Every fetched
 * image is re-validated by its magic bytes and its declared size, so what is
 * kept and served is never trusted from a header. Null means no icon: the
 * client shows a letter. A short in-flight marker in KV (best effort, KV is
 * eventually consistent) makes concurrent cold requests answer `busy` instead
 * of all fetching. Callers gate this on a consented, connected connector.
 */
export async function resolveConnectorIcon(
  kv: KVNamespace,
  connector: ConnectorIconTarget,
  options: {
    logger?: LoggerLike
    dependencies?: ConnectorIconDependencies
  } = {},
): Promise<ConnectorIconImage | null | typeof CONNECTOR_ICON_BUSY> {
  const stored = await readStoredIcon(kv, connector.id)

  if (stored.isStored) {
    return stored.image
  }

  if (!await acquireIconLock(kv, connector.id)) {
    return CONNECTOR_ICON_BUSY
  }

  try {
    return await fetchAndStoreIcon(kv, connector, options)
  } finally {
    await releaseIconLock(kv, connector.id)
  }
}

export async function deleteConnectorIconCache(
  kv: KVNamespace,
  connectorId: string,
): Promise<void> {
  try {
    await kv.delete(connectorIconKey(connectorId))
    await kv.delete(connectorIconSourcesKey(connectorId))
    await kv.delete(connectorIconLockKey(connectorId))
  } catch {
    return
  }
}
