export default defineEventHandler(async (event) => {
  const session = await useUserSession(event)

  if (!session) {
    return useUnauthorizedError()
  }

  const keys = await useDb().query.keys.findFirst({
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

  return keys
    ? {
      apiKey: await useDecryptText(keys.apiKey),
    }
    : {
      apiKey: '',
    }
})
