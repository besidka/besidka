import { customType } from 'drizzle-orm/sqlite-core'
import { encodeId, decodeId } from './hashids'

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
    return encodeId(value)
  },
  toDriver(value) {
    return decodeId(value)
  },
})
