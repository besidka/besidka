export default defineNuxtPlugin(() => {
  const { user } = useAuth()
  const { syncForUser, clearUserContext } = useUserSetting()
  const { bindUser: bindLegalConsentUser } = useLegalConsent()

  watch(() => {
    if (!user.value?.id) {
      return null
    }

    return String(user.value.id)
  }, (nextUserId, previousUserId) => {
    if (nextUserId === previousUserId) {
      return
    }

    bindLegalConsentUser(nextUserId ?? null)

    if (!nextUserId) {
      clearUserContext()

      return
    }

    void syncForUser(nextUserId)
  }, {
    immediate: true,
  })
})
