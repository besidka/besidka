import { describe, expect, it } from 'vitest'
import {
  buildPushRequest,
  buildVapidAuthorization,
  encryptPushPayload,
  isValidVapidPublicKey,
} from '../../../server/utils/push-protocol'

// Unmocked, real-crypto verification of the in-house RFC 8291/8292
// implementation. This file exists because every Web Push library evaluated
// for this feature failed in production: web-push's VAPID signing throws
// "hasOwnProperty is not a function" through asn1.js on workerd,
// @block65/webcrypto-web-push and @pushforge/builder emit only the legacy
// pre-RFC 'aesgcm' coding that Apple's push service rejects, and
// web-push-browser wrote the RFC 8188 record-size field little-endian. The
// encryption below is pinned byte-for-byte to the OFFICIAL RFC 8291
// Appendix A test vector so it can never silently regress.

const RFC8291_VECTOR = {
  plaintext: 'When I grow up, I want to be a watermelon',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  expectedBody: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

const testVapid = {
  publicKey: RFC8291_VECTOR.asPublic,
  privateKey: RFC8291_VECTOR.asPrivate,
  subject: 'mailto:abuse@besidka.com',
}

async function createSubscriberKeys() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )
  const publicBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', keyPair.publicKey),
  )

  return {
    p256dh: Buffer.from(publicBytes).toString('base64url'),
    auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16)))
      .toString('base64url'),
  }
}

describe('push-protocol encryption', () => {
  it('reproduces the RFC 8291 Appendix A test vector byte-for-byte', async () => {
    const body = await encryptPushPayload(
      RFC8291_VECTOR.uaPublic,
      RFC8291_VECTOR.authSecret,
      RFC8291_VECTOR.plaintext,
      {
        salt: new Uint8Array(
          Buffer.from(RFC8291_VECTOR.salt, 'base64url'),
        ),
        senderPublicKey: RFC8291_VECTOR.asPublic,
        senderPrivateKeyD: RFC8291_VECTOR.asPrivate,
      },
    )

    expect(Buffer.from(body).toString('base64url'))
      .toBe(RFC8291_VECTOR.expectedBody)
  })

  it('encodes the record-size field in network byte order (big-endian), per RFC 8188 section 2.1', async () => {
    const subscriberKeys = await createSubscriberKeys()

    const body = Buffer.from(await encryptPushPayload(
      subscriberKeys.p256dh,
      subscriberKeys.auth,
      JSON.stringify({ title: 't', body: 'b', url: '/chats/1' }),
    ))

    // aes128gcm header layout (RFC 8188 §2.1):
    // salt (16) | rs (4) | idlen (1) | keyid (idlen)
    const recordSize = body.readUInt32BE(16)

    expect(recordSize).toBe(4096)

    // The bug this guards against: web-push-browser encoded this same field
    // as little-endian, which for 4096 (0x00001000) reads back as
    // 0x00100000 (1048576) — a receiver decoding per the RFC would see that
    // garbage value instead, since it always reads big-endian regardless of
    // how the sender wrote it.
    const littleEndianMisread = body.readUInt32LE(16)

    expect(littleEndianMisread).toBe(1048576)
    expect(recordSize).not.toBe(littleEndianMisread)
    expect(body[20]).toBe(65)
  })

  it('rejects malformed subscriber key material', async () => {
    await expect(encryptPushPayload('not-a-point', 'BTBZMqHH6r4Tts7J_aSIgg', 'x'))
      .rejects.toThrow('p256dh')
    await expect(encryptPushPayload(RFC8291_VECTOR.uaPublic, 'short', 'x'))
      .rejects.toThrow('auth secret')
  })
})

describe('push-protocol VAPID authorization', () => {
  it('produces a verifiable ES256 JWT with the RFC 8292 claims', async () => {
    const endpoint = 'https://web.push.apple.com/QAbCdEf'
    const authorization = await buildVapidAuthorization(endpoint, testVapid)

    expect(authorization.startsWith('vapid t=')).toBe(true)
    expect(authorization).toContain(`k=${testVapid.publicKey}`)

    const token = authorization
      .slice('vapid t='.length)
      .split(',')[0] as string
    const [headerPart, claimsPart, signaturePart] = token.split('.')

    const header = JSON.parse(
      Buffer.from(headerPart as string, 'base64url').toString(),
    )
    const claims = JSON.parse(
      Buffer.from(claimsPart as string, 'base64url').toString(),
    )

    expect(header).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(claims.aud).toBe('https://web.push.apple.com')
    expect(claims.sub).toBe('mailto:abuse@besidka.com')
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(claims.exp).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    )

    const publicKeyBytes = new Uint8Array(
      Buffer.from(testVapid.publicKey, 'base64url'),
    )
    const verifyKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      new Uint8Array(Buffer.from(signaturePart as string, 'base64url')),
      new TextEncoder().encode(`${headerPart}.${claimsPart}`),
    )

    expect(verified).toBe(true)
  })
})

describe('push-protocol request building', () => {
  it('uses the RFC 8291 aes128gcm content-encoding, not the legacy aesgcm', async () => {
    const subscriberKeys = await createSubscriberKeys()

    const request = await buildPushRequest({
      endpoint: 'https://fcm.googleapis.com/fcm/send/sub-1',
      p256dhKey: subscriberKeys.p256dh,
      authKey: subscriberKeys.auth,
      payload: JSON.stringify({ title: 't', body: 'b', url: '/chats/1' }),
      ttl: 300,
      urgency: 'normal',
      vapid: testVapid,
    })

    expect(request.headers['content-encoding']).toBe('aes128gcm')
    expect(request.headers.ttl).toBe('300')
    expect(request.headers.urgency).toBe('normal')
    // The legacy scheme's separate Encryption/Crypto-Key headers must be
    // absent — aes128gcm embeds the salt and sender key in the body itself.
    expect(request.headers.Encryption).toBeUndefined()
    expect(request.headers['Crypto-Key']).toBeUndefined()
    expect(request.body.byteLength).toBeGreaterThan(86)
  })
})

describe('push-protocol key validation', () => {
  it('accepts a raw uncompressed P-256 public key', () => {
    expect(isValidVapidPublicKey(RFC8291_VECTOR.asPublic)).toBe(true)
  })

  it('rejects strings that are not a 65-byte 0x04-prefixed point', () => {
    expect(isValidVapidPublicKey('public-key')).toBe(false)
    expect(isValidVapidPublicKey('')).toBe(false)
  })
})
