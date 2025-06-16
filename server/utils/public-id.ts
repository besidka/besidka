import { customType } from 'drizzle-orm/sqlite-core'
import { encodeId, decodeId } from './hashids'

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
    return encodeId(value)
  },
  toDriver(value) {
    return decodeId(value)
  },
})
