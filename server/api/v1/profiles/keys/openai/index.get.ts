export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const data = await useDb().query.keys.findFirst({
    where: {
      userId: parseInt(session.user.id),
      provider: 'openai',
    },
    columns: {
      apiKey: true,
    },
  })

  return data?.apiKey
    ? await useDecryptText(data.apiKey)
    : ''
})
