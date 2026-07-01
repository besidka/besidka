import { describe, expect, it } from 'vitest'
import { createECDH, randomBytes } from 'node:crypto'
import { generateRequestDetails } from 'web-push'

// Unmocked, real-crypto verification — deliberately separate from
// push.spec.ts's mocked orchestration tests. This exists because two other
// WebCrypto-based Web Push libraries evaluated for this feature
// (@block65/webcrypto-web-push and @pushforge/builder) both unconditionally
// emit the legacy pre-RFC-8291 'aesgcm' content-encoding despite claiming
// RFC 8291 support, and a third (web-push-browser) correctly chose
// 'aes128gcm' but encoded the record-size field in the wrong byte order
// (native/little-endian instead of RFC 8188's mandated network/big-endian
// order) — a bug that would silently fail against any spec-compliant
// receiver, Apple's web.push.apple.com in particular. web-push's own
// http_ece dependency was confirmed correct by reading its source
// (ints.writeUIntBE for the record-size field). This test pins that
// property so it can never silently regress.
function createSubscriberKeys() {
  const curve = createECDH('prime256v1')

  curve.generateKeys()

  return {
    p256dh: curve.getPublicKey('base64url'),
    auth: randomBytes(16).toString('base64url'),
  }
}

describe('web-push encryption output', () => {
  it('uses the RFC 8291 aes128gcm content-encoding, not the legacy aesgcm', () => {
    const subscriberKeys = createSubscriberKeys()

    const requestDetails = generateRequestDetails(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/sub-1',
        keys: subscriberKeys,
      },
      JSON.stringify({ title: 't', body: 'b', url: '/chats/1' }),
      {
        vapidDetails: {
          subject: 'mailto:abuse@besidka.com',
          publicKey: 'BLOOCZ7vtaGo_lDmSmuqPL7gz5Z8ydQiCQ6yHI0RD774A960E9VBmfdqi5Ckqziu4OsoQxoKtI2icMB81q28lWs',
          privateKey: 'MJlR-tU6qD3q4MBWqAn7ocR9BLwm9TVqZa7Ce4AWaQg',
        },
        TTL: 300,
        urgency: 'normal',
        contentEncoding: 'aes128gcm',
      },
    )

    expect(requestDetails.headers['Content-Encoding']).toBe('aes128gcm')
    // The legacy scheme's separate Encryption/Crypto-Key headers must be
    // absent — aes128gcm embeds the salt and sender key in the body itself.
    expect(requestDetails.headers.Encryption).toBeUndefined()
    expect(requestDetails.headers['Crypto-Key']).toBeUndefined()
  })

  it('encodes the record-size field in network byte order (big-endian), per RFC 8188 section 2.1', () => {
    const subscriberKeys = createSubscriberKeys()

    const requestDetails = generateRequestDetails(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/sub-1',
        keys: subscriberKeys,
      },
      JSON.stringify({ title: 't', body: 'b', url: '/chats/1' }),
      {
        vapidDetails: {
          subject: 'mailto:abuse@besidka.com',
          publicKey: 'BLOOCZ7vtaGo_lDmSmuqPL7gz5Z8ydQiCQ6yHI0RD774A960E9VBmfdqi5Ckqziu4OsoQxoKtI2icMB81q28lWs',
          privateKey: 'MJlR-tU6qD3q4MBWqAn7ocR9BLwm9TVqZa7Ce4AWaQg',
        },
        TTL: 300,
        urgency: 'normal',
        contentEncoding: 'aes128gcm',
      },
    )

    const body = requestDetails.body

    if (!body) {
      throw new Error('Expected an encrypted body')
    }

    // aes128gcm header layout (RFC 8188 §2.1):
    // salt (16) | rs (4) | idlen (1) | keyid (idlen)
    // http_ece defaults rs to 4096 when unspecified — reading it correctly
    // as big-endian must yield exactly that, not a byte-swapped value.
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
  })
})
