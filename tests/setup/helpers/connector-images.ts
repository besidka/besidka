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
