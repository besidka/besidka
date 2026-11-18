export const RED_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC'

export const RED_PNG_BYTES = 75

export function toBase64(bytes: readonly number[]): string {
  return Buffer.from(bytes).toString('base64')
}

export function imageOfBytes(
  signature: readonly number[],
  totalBytes: number,
): string {
  const bytes = new Uint8Array(totalBytes)

  bytes.set(signature)

  return Buffer.from(bytes).toString('base64')
}

export function mcpImage(data: string, mimeType = 'image/png') {
  return { type: 'image', data, mimeType }
}

function uint16BigEndian(value: number): number[] {
  return [(value >> 8) & 0xFF, value & 0xFF]
}

function uint16LittleEndian(value: number): number[] {
  return [value & 0xFF, (value >> 8) & 0xFF]
}

function uint24LittleEndian(value: number): number[] {
  return [value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF]
}

function uint32BigEndian(value: number): number[] {
  return [
    (value >>> 24) & 0xFF,
    (value >> 16) & 0xFF,
    (value >> 8) & 0xFF,
    value & 0xFF,
  ]
}

function uint32LittleEndian(value: number): number[] {
  return uint32BigEndian(value).reverse()
}

export function pngHeaderBytes(width: number, height: number): number[] {
  return [
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    ...uint32BigEndian(width),
    ...uint32BigEndian(height),
    0x08, 0x02, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
  ]
}

export function jpegBytes(width: number, height: number): number[] {
  return [
    0xFF, 0xD8,
    0xFF, 0xC0, 0x00, 0x11, 0x08,
    ...uint16BigEndian(height),
    ...uint16BigEndian(width),
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xFF, 0xD9,
  ]
}

export function gifBytes(width: number, height: number): number[] {
  return [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    ...uint16LittleEndian(width),
    ...uint16LittleEndian(height),
    0x00, 0x00, 0x00,
    0x3B,
  ]
}

export function webpBytes(width: number, height: number): number[] {
  const chunk = [
    0x56, 0x50, 0x38, 0x58,
    ...uint32LittleEndian(10),
    0x00, 0x00, 0x00, 0x00,
    ...uint24LittleEndian(width - 1),
    ...uint24LittleEndian(height - 1),
  ]

  return [
    0x52, 0x49, 0x46, 0x46,
    ...uint32LittleEndian(4 + chunk.length),
    0x57, 0x45, 0x42, 0x50,
    ...chunk,
  ]
}
