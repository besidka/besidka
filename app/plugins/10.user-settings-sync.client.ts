export default defineNuxtPlugin(() => {
  const { user } = useAuth()
  const { syncForUser, clearUserContext } = useUserSetting()

  watch(() => {
    if (!user.value?.id) {
      return null
    }

    return String(user.value.id)
  }, (nextUserId, previousUserId) => {
    if (nextUserId === previousUserId) {
      return
    }

    if (!nextUserId) {
      clearUserContext()

      return
    }

    void syncForUser(nextUserId)
  }, {
    immediate: true,
  })
})
