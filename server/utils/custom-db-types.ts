import { customType } from 'drizzle-orm/sqlite-core'
import Hashids from 'hashids'
import crypto from 'node:crypto'

let hashidsInstance: Hashids | null = null

function getHashidsInstance(): Hashids {
  if (hashidsInstance) {
    return hashidsInstance
  }

  const { encryption: { hashids } } = useRuntimeConfig()

  hashidsInstance = new Hashids(hashids, 16)

  return hashidsInstance
}

function encodePublicId(id: number): string {
  return getHashidsInstance().encode(id)
}

function decodePublicId(publicId: string): number {
  const [id] = getHashidsInstance().decode(publicId)

  return Number(id)
}

// @TODO: Custom type doesn't work with auto-increment
// https://github.com/drizzle-team/drizzle-orm/issues/818#issuecomment-2960199129
export const publicId = customType<{
  data: string
  driverData: number
  notNull: true
  default: true
}>({
  dataType() {
    return 'integer'
  },
  fromDriver(value) {
    return encodePublicId(value)
  },
  toDriver(value) {
    return decodePublicId(value)
  },
})

let cryptoInstance: Buffer<ArrayBufferLike> | null = null

function getCryptoInstance() {
  if (cryptoInstance) {
    return cryptoInstance
  }

  const { encryption: { key } } = useRuntimeConfig()

  cryptoInstance = crypto
    .createHash('sha256')
    .update(key)
    .digest()

  return cryptoInstance
}

const IV_LENGTH = 12

function encryptText(plain: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    getCryptoInstance(),
    iv,
    {
      authTagLength: 16,
    },
  )
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

function decryptText(cipherTextBase64: string): string {
  const raw = Buffer.from(cipherTextBase64, 'base64')

  const iv = raw.subarray(0, IV_LENGTH)
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + 16)
  const text = raw.subarray(IV_LENGTH + 16)
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getCryptoInstance(),
    iv,
    {
      authTagLength: 16,
    },
  )

  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([decipher.update(text), decipher.final()])

  return decrypted.toString('utf8')
}

export const encryptedText = customType<{
  data: string
  driverData: string
  notNull: true
}>({
  dataType() {
    return 'text'
  },
  fromDriver(value) {
    return decryptText(value)
  },
  toDriver(value) {
    return encryptText(value)
  },
})
