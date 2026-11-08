export default defineNuxtPlugin({
  name: 'features',
  dependsOn: ['better-auth-fetch-plugin'],
  async setup(nuxtApp) {
    const {
      features,
      refreshFeatures,
      clearFeatures,
      prefillServerFeatures,
    } = useFeatures()

    if (import.meta.server) {
      await prefillServerFeatures(nuxtApp.payload)

      return
    }

    const { user } = useAuth()

    watch(() => {
      return user.value?.id ? String(user.value.id) : null
    }, async (nextUserId, previousUserId) => {
      if (nextUserId === previousUserId) {
        return
      }

      clearFeatures()
      await refreshFeatures()
    })

    if (!features.value) {
      nuxtApp.hook('app:mounted', async () => {
        if (!features.value) {
          await refreshFeatures()
        }
      })
    }
  },
})
