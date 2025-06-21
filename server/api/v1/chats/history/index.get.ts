export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  return await useDb().query.chats.findMany({
    where(chats, { eq }) {
      return eq(chats.userId, parseInt(session.user.id))
    },
    orderBy: (chats, { desc }) => desc(chats.createdAt),
    limit: 100,
    columns: {
      id: true,
      slug: true,
      title: true,
      createdAt: true,
    },
  })
})
