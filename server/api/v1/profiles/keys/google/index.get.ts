export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const data = await useDb().query.keys.findFirst({
    where(keys, { and, eq }) {
      return and(
        eq(keys.userId, parseInt(session.user.id)),
        eq(keys.provider, 'google'),
      )
    },
    columns: {
      apiKey: true,
    },
  })

  return data?.apiKey
    ? await useDecryptText(data.apiKey)
    : ''
})
