const textEncoder = new TextEncoder()
const EMPTY_SALT = new Uint8Array(0)
const DEFAULT_KEY_BYTES = 32

/**
 * HKDF-SHA-256 with an empty salt: the bytes derived from `secret` for one
 * purpose, named by `info`. Two purposes with different `info` strings get
 * unrelated keys from the same secret.
 */
export async function deriveHkdfBytes(
  secret: string,
  info: string,
  byteLength: number = DEFAULT_KEY_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    'HKDF',
    false,
    ['deriveBits'],
  )
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: EMPTY_SALT,
      info: textEncoder.encode(info),
    },
    baseKey,
    byteLength * 8,
  )

  return new Uint8Array(derived)
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}
