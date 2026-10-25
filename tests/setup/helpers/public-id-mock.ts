export async function publicIdMockFactory() {
  const { customType } = await import('drizzle-orm/sqlite-core')

  return {
    encodePublicId: (id: number) => `pub-${id}`,
    decodePublicId: (publicId: string) => Number(publicId.slice(4)),
    publicId: customType<{
      data: string
      driverData: number
      notNull: true
      default: true
    }>({
      dataType() {
        return 'integer'
      },
      fromDriver(value) {
        return `pub-${value}`
      },
      toDriver(value) {
        return Number(value.slice(4))
      },
    }),
  }
}
