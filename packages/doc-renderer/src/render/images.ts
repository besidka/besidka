import { Unzlib } from 'fflate'
import { collectImageIds } from '../spec/bounds.ts'
import type { DocumentSpec } from '../spec/v1.ts'
import { RenderError } from './errors.ts'

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

export interface ImageAsset {
  bytes: Uint8Array
  mediaType: ImageMediaType
}

export type RenderAssets = Map<string, ImageAsset>

export interface PreparedImage {
  bytes: Uint8Array
  kind: 'png' | 'jpeg'
  mediaType: 'image/png' | 'image/jpeg'
  width: number
  height: number
}

export const IMAGE_LIMITS = {
  bytesEach: 5 * 1024 * 1024,
  bytesTotal: 20 * 1024 * 1024,
  dimensionMax: 16384,
  pixelsMax: 10_000_000,
} as const

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) * 0x1000000)
    + ((bytes[offset + 1] as number) << 16)
    + ((bytes[offset + 2] as number) << 8)
    + (bytes[offset + 3] as number)
  )
}

interface ImageSize {
  width: number
  height: number
}

function readPngSize(bytes: Uint8Array): ImageSize | null {
  const isPng = PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)

  if (!isPng || bytes.length < 24) {
    return null
  }

  return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) }
}

function readJpegSize(bytes: Uint8Array): ImageSize | null {
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
    return null
  }

  let offset = 2

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xFF) {
      return null
    }

    const marker = bytes[offset + 1] as number

    if (marker === 0xFF) {
      offset += 1
      continue
    }

    const length = ((bytes[offset + 2] as number) << 8)
      | (bytes[offset + 3] as number)
    const isFrameHeader = marker >= 0xC0
      && marker <= 0xCF
      && marker !== 0xC4
      && marker !== 0xC8
      && marker !== 0xCC

    if (isFrameHeader) {
      return {
        height: ((bytes[offset + 5] as number) << 8)
          | (bytes[offset + 6] as number),
        width: ((bytes[offset + 7] as number) << 8)
          | (bytes[offset + 8] as number),
      }
    }

    if (length < 2) {
      return null
    }

    offset += 2 + length
  }

  return null
}

class InflateOverflow extends Error {}

const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function pngDecodesWithinBound(
  bytes: Uint8Array,
  width: number,
  height: number,
): boolean {
  const channels = PNG_CHANNELS[bytes[25] as number]
  const bitDepth = bytes[24] as number

  if (!channels || !bitDepth) {
    return false
  }

  const rowBytes = Math.ceil(width * channels * bitDepth / 8)
  const bound = height * (1 + rowBytes) + height * 8 + 1024
  let produced = 0
  const inflater = new Unzlib((chunk) => {
    produced += chunk.length

    if (produced > bound) {
      throw new InflateOverflow()
    }
  })
  let offset = 8

  try {
    while (offset + 12 <= bytes.length) {
      const length = readUint32(bytes, offset)
      const type = String.fromCharCode(
        ...bytes.subarray(offset + 4, offset + 8),
      )

      if (type === 'IDAT') {
        inflater.push(bytes.subarray(offset + 8, offset + 8 + length), false)
      }

      if (type === 'IEND') {
        break
      }

      offset += 12 + length
    }

    inflater.push(new Uint8Array(0), true)
  } catch {
    return false
  }

  return true
}

export function prepareImage(fileId: string, asset: ImageAsset): PreparedImage {
  if (asset.mediaType === 'image/webp') {
    throw new RenderError(
      'unsupported_image',
      `Image ${fileId}: WebP cannot be embedded, convert it to PNG or JPEG first`,
    )
  }

  if (asset.bytes.length === 0 || asset.bytes.length > IMAGE_LIMITS.bytesEach) {
    throw new RenderError('image_too_large', `Image ${fileId} exceeds 5 MB`)
  }

  const isPng = asset.mediaType === 'image/png'
  const size = isPng ? readPngSize(asset.bytes) : readJpegSize(asset.bytes)

  if (!size || size.width < 1 || size.height < 1) {
    throw new RenderError(
      'unsupported_image',
      `Image ${fileId}: bytes do not match ${asset.mediaType}`,
    )
  }

  const isTooLarge = size.width > IMAGE_LIMITS.dimensionMax
    || size.height > IMAGE_LIMITS.dimensionMax
    || size.width * size.height > IMAGE_LIMITS.pixelsMax

  if (isTooLarge) {
    throw new RenderError('image_too_large', `Image ${fileId} has too many pixels`)
  }

  if (isPng && !pngDecodesWithinBound(asset.bytes, size.width, size.height)) {
    throw new RenderError(
      'image_too_large',
      `Image ${fileId} inflates beyond its declared size`,
    )
  }

  return {
    bytes: asset.bytes,
    kind: isPng ? 'png' : 'jpeg',
    mediaType: isPng ? 'image/png' : 'image/jpeg',
    width: size.width,
    height: size.height,
  }
}

/**
 * Resolves every image the spec references. The renderer never fetches:
 * ownership is decided by the caller, who passes the bytes in.
 */
export function prepareImages(
  spec: DocumentSpec,
  assets: RenderAssets,
): Map<string, PreparedImage> {
  let total = 0

  for (const asset of assets.values()) {
    total += asset.bytes.length
  }

  if (total > IMAGE_LIMITS.bytesTotal) {
    throw new RenderError('assets_too_large', 'Assets exceed 20 MB in total')
  }

  const prepared = new Map<string, PreparedImage>()

  for (const fileId of collectImageIds(spec)) {
    if (prepared.has(fileId)) {
      continue
    }

    const asset = assets.get(fileId)

    if (!asset) {
      throw new RenderError('missing_asset', `Image ${fileId} was not provided`)
    }

    prepared.set(fileId, prepareImage(fileId, asset))
  }

  return prepared
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''

  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize))
  }

  return btoa(binary)
}
