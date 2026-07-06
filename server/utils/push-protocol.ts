/**
 * Web Push request building on pure WebCrypto — no dependencies.
 *
 * Implements RFC 8291 (Message Encryption for Web Push, aes128gcm per
 * RFC 8188) and RFC 8292 (VAPID) directly, because every library evaluated
 * for this failed on one half of the protocol when running on Cloudflare
 * Workers: `web-push` signs its VAPID JWT through jws/asn1.js which throws
 * "hasOwnProperty is not a function" in the workerd bundle;
 * @block65/webcrypto-web-push and @pushforge/builder emit only the legacy
 * pre-RFC "aesgcm" coding that Apple's push service rejects; and
 * web-push-browser encodes the RFC 8188 record-size field little-endian.
 * WebCrypto is workerd's native crypto API, ECDSA signatures come out as the
 * raw r||s that JWS ES256 requires (no ASN.1/DER involved), and the
 * encryption path is pinned to the official RFC 8291 Appendix A test vector
 * in tests/unit/utils/push-encryption.spec.ts.
 *
 * Key formats match what `npx web-push generate-vapid-keys` emits and what
 * PushSubscription.getKey() provides: base64url of the raw 65-byte
 * uncompressed P-256 point for public keys, base64url of the raw 32-byte
 * scalar for the private key, base64url of the 16-byte auth secret.
 */

const RECORD_SIZE = 4096
const VAPID_JWT_LIFETIME_SECONDS = 12 * 60 * 60

const encoder = new TextEncoder()

export interface PushRequestVapid {
  publicKey: string
  privateKey: string
  subject: string
}

export interface PushEncryptionOverrides {
  salt?: Uint8Array
  senderPublicKey?: string
  senderPrivateKeyD?: string
}

export interface BuildPushRequestInput {
  endpoint: string
  p256dhKey: string
  authKey: string
  payload: string
  ttl: number
  urgency: 'very-low' | 'low' | 'normal' | 'high'
  vapid: PushRequestVapid
}

function base64UrlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

function isUncompressedP256Point(bytes: Uint8Array): boolean {
  return bytes.length === 65 && bytes[0] === 4
}

export function isValidVapidPublicKey(publicKey: string): boolean {
  try {
    return isUncompressedP256Point(base64UrlToBytes(publicKey))
  } catch (exception) {
    void exception

    return false
  }
}

function publicKeyJwkCoordinates(publicKeyBytes: Uint8Array): {
  x: string
  y: string
} {
  return {
    x: bytesToBase64Url(publicKeyBytes.subarray(1, 33)),
    y: bytesToBase64Url(publicKeyBytes.subarray(33, 65)),
  }
}

async function hkdfDeriveBits(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  bits: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    inputKeyMaterial as BufferSource,
    'HKDF',
    false,
    ['deriveBits'],
  )
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: info as BufferSource,
    },
    key,
    bits,
  )

  return new Uint8Array(derived)
}

async function createSenderKeyPair(
  overrides?: PushEncryptionOverrides,
): Promise<{ privateKey: CryptoKey, publicKeyBytes: Uint8Array }> {
  if (overrides?.senderPublicKey && overrides.senderPrivateKeyD) {
    const publicKeyBytes = base64UrlToBytes(overrides.senderPublicKey)
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        d: overrides.senderPrivateKeyD,
        ...publicKeyJwkCoordinates(publicKeyBytes),
      },
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    )

    return { privateKey, publicKeyBytes }
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )
  const publicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', keyPair.publicKey),
  )

  return { privateKey: keyPair.privateKey, publicKeyBytes }
}

export async function encryptPushPayload(
  p256dhKey: string,
  authKey: string,
  payload: string,
  overrides?: PushEncryptionOverrides,
): Promise<Uint8Array> {
  const subscriberPublicBytes = base64UrlToBytes(p256dhKey)

  if (!isUncompressedP256Point(subscriberPublicBytes)) {
    throw new Error('subscription p256dh key is not a P-256 point')
  }

  const authSecret = base64UrlToBytes(authKey)

  if (authSecret.length !== 16) {
    throw new Error('subscription auth secret must be 16 bytes')
  }

  const sender = await createSenderKeyPair(overrides)

  const subscriberKey = await crypto.subtle.importKey(
    'raw',
    subscriberPublicBytes as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: subscriberKey },
    sender.privateKey,
    256,
  ))

  const keyInfo = concatBytes(
    encoder.encode('WebPush: info\0'),
    subscriberPublicBytes,
    sender.publicKeyBytes,
  )
  const inputKeyMaterial = await hkdfDeriveBits(
    ecdhSecret,
    authSecret,
    keyInfo,
    256,
  )

  const salt = overrides?.salt
    ?? crypto.getRandomValues(new Uint8Array(16))
  const contentEncryptionKey = await hkdfDeriveBits(
    inputKeyMaterial,
    salt,
    encoder.encode('Content-Encoding: aes128gcm\0'),
    128,
  )
  const nonce = await hkdfDeriveBits(
    inputKeyMaterial,
    salt,
    encoder.encode('Content-Encoding: nonce\0'),
    96,
  )

  const aesKey = await crypto.subtle.importKey(
    'raw',
    contentEncryptionKey as BufferSource,
    'AES-GCM',
    false,
    ['encrypt'],
  )
  const plaintextWithDelimiter = concatBytes(
    encoder.encode(payload),
    Uint8Array.of(2),
  )
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    aesKey,
    plaintextWithDelimiter as BufferSource,
  ))

  const header = new Uint8Array(16 + 4 + 1 + 65)

  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = 65
  header.set(sender.publicKeyBytes, 21)

  return concatBytes(header, ciphertext)
}

export async function buildVapidAuthorization(
  endpoint: string,
  vapid: PushRequestVapid,
): Promise<string> {
  const publicKeyBytes = base64UrlToBytes(vapid.publicKey)

  if (!isUncompressedP256Point(publicKeyBytes)) {
    throw new Error('VAPID public key is not a P-256 point')
  }

  let signingKey: CryptoKey

  try {
    signingKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        d: vapid.privateKey,
        ...publicKeyJwkCoordinates(publicKeyBytes),
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
  } catch (exception) {
    throw new Error(
      'VAPID public/private keys are not a valid P-256 pair — regenerate '
      + 'both together with scripts/generate-vapid-keys.mjs and deploy them '
      + 'in the same release',
      { cause: exception },
    )
  }

  const header = bytesToBase64Url(
    encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })),
  )
  const claims = bytesToBase64Url(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + VAPID_JWT_LIFETIME_SECONDS,
    sub: vapid.subject,
  })))
  const unsignedToken = `${header}.${claims}`

  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    encoder.encode(unsignedToken),
  ))

  return `vapid t=${unsignedToken}.${bytesToBase64Url(signature)}, `
    + `k=${vapid.publicKey}`
}

export async function buildPushRequest(
  input: BuildPushRequestInput,
  overrides?: PushEncryptionOverrides,
): Promise<{ headers: Record<string, string>, body: Uint8Array }> {
  const body = await encryptPushPayload(
    input.p256dhKey,
    input.authKey,
    input.payload,
    overrides,
  )
  const authorization = await buildVapidAuthorization(
    input.endpoint,
    input.vapid,
  )

  return {
    headers: {
      'authorization': authorization,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      'ttl': String(input.ttl),
      'urgency': input.urgency,
    },
    body,
  }
}
