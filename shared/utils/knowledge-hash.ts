const textEncoder = new TextEncoder()

/**
 * The one content hash of the knowledge feature: SHA-256 as 64 lowercase hex
 * characters. Text is hashed as its UTF-8 bytes, so a text file hashed from
 * its bytes on the client and the same text hashed on the server agree.
 */
export async function sha256Hex(input: BufferSource | string): Promise<string> {
  const bytes = typeof input === 'string' ? textEncoder.encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', bytes)

  return Array.from(new Uint8Array(digest), (byte) => {
    return byte.toString(16).padStart(2, '0')
  }).join('')
}
