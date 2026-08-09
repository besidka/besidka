export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const data = await useDb().query.keys.findFirst({
    where: {
      userId: parseInt(session.user.id),
      provider: 'qwen',
    },
    columns: {
      apiKey: true,
    },
  })

  return { hasKey: !!data?.apiKey }
})
