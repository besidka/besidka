export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const keys = await useDb().query.keys.findFirst({
    where(keys, { and, eq }) {
      return and(
        eq(keys.userId, parseInt(session.user.id)),
        eq(keys.provider, 'openai'),
      )
    },
    columns: {
      apiKey: true,
      projectId: true,
    },
  })

  return keys
    ? {
      apiKey: await useDecryptText(keys.apiKey),
      projectId: keys.projectId
        ? await useDecryptText(keys.projectId)
        : '',
    }
    : {
      apiKey: '',
      projectId: '',
    }
})
