import { customType } from 'drizzle-orm/sqlite-core'
import Hashids from 'hashids'

let hashidsInstance: Hashids | null = null

function getHashidsInstance(): Hashids {
  if (hashidsInstance) {
    return hashidsInstance
  }

  const { encryptionHashids } = useRuntimeConfig()

  hashidsInstance = new Hashids(encryptionHashids, 16)

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
