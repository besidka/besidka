/**
 * Alphanumeric stand-in for the Hashids public id: the real ids are
 * alphanumeric too, and the skill key builder rejects anything else. Kept
 * free of schema imports so a `vi.mock` factory can load it without a cycle.
 */
export async function skillPublicIdMockFactory() {
  const { customType } = await import('drizzle-orm/sqlite-core')

  return {
    encodePublicId: (id: number) => `skl${id}`,
    decodePublicId: (publicId: string) => Number(publicId.slice(3)),
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
        return `skl${value}`
      },
      toDriver(value) {
        return Number(value.slice(3))
      },
    }),
  }
}
