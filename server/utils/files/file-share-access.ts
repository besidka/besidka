import type { H3Event } from 'h3'

const FILE_ACCESS_TOKEN_HEADER = {
  alg: 'HS256',
  typ: 'BESIDKA_FILE_SHARE',
}

export interface FileAccessTokenPayload {
  shareId: string
  fileId: string
  exp: number
}

export async function createFileAccessToken(
  payload: {
    shareId: string
    fileId: string
    expiresInSeconds?: number
  },
  event: H3Event = useEvent(),
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + (payload.expiresInSeconds || 300)
  const encodedHeader = encodeJson(FILE_ACCESS_TOKEN_HEADER)
  const encodedPayload = encodeJson({
    shareId: payload.shareId,
    fileId: payload.fileId,
    exp,
  })
  const signature = await signToken(
    `${encodedHeader}.${encodedPayload}`,
    event,
  )

  return `${encodedHeader}.${encodedPayload}.${signature}`
}

export async function hasShareTokenFileAccess(
  token: string,
  fileId: string,
  event: H3Event = useEvent(),
): Promise<boolean> {
  const payload = await verifyFileAccessToken(token, event)

  if (!payload || payload.fileId !== fileId) {
    return false
  }

  const now = new Date()
  const shareGrant = await useDb().query.chatShareFiles.findFirst({
    where(chatShareFiles, { and, eq }) {
      return and(
        eq(chatShareFiles.chatShareId, payload.shareId),
        eq(chatShareFiles.fileId, payload.fileId),
      )
    },
    columns: {
      id: true,
    },
    with: {
      share: {
        columns: {
          revoked: true,
          expiresAt: true,
        },
      },
    },
  })

  if (!shareGrant) {
    return false
  }

  const share = shareGrant.share

  if (!share || share.revoked) {
    return false
  }

  if (share.expiresAt && share.expiresAt <= now) {
    return false
  }

  return true
}

async function verifyFileAccessToken(
  token: string,
  event: H3Event,
): Promise<FileAccessTokenPayload | null> {
  const [encodedHeader, encodedPayload, providedSignature] = token.split('.')

  if (!encodedHeader || !encodedPayload || !providedSignature) {
    return null
  }

  const expectedSignature = await signToken(
    `${encodedHeader}.${encodedPayload}`,
    event,
  )

  if (providedSignature !== expectedSignature) {
    return null
  }

  const payload = decodeJson<FileAccessTokenPayload>(encodedPayload)

  if (!payload) {
    return null
  }

  const nowSeconds = Math.floor(Date.now() / 1000)

  if (!payload.exp || payload.exp <= nowSeconds) {
    return null
  }

  return payload
}

async function signToken(
  value: string,
  event: H3Event,
): Promise<string> {
  const cryptoKey = await getTokenCryptoKey(event)
  const bytes = new TextEncoder().encode(value)
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, bytes)

  return base64UrlEncode(new Uint8Array(signature))
}

async function getTokenCryptoKey(event: H3Event): Promise<CryptoKey> {
  const secret = useRuntimeConfig(event).encryptionKey

  if (!secret) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Missing file access token secret',
    })
  }

  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

function encodeJson(payload: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))
}

function decodeJson<T>(value: string): T | null {
  try {
    const bytes = base64UrlDecode(value)
    const text = new TextDecoder().decode(bytes)

    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  const stringValue = String.fromCharCode(...bytes)

  return btoa(stringValue)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, '=')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}
