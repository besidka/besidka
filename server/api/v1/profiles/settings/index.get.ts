export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const settings = await useDb().query.userSettings.findFirst({
    where(userSettings, { eq }) {
      return eq(userSettings.userId, parseInt(session.user.id))
    },
    columns: {
      reasoningExpanded: true,
    },
  })

  return {
    reasoningExpanded: settings?.reasoningExpanded ?? false,
  }
})
