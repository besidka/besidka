export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  const { captureUtmFromQuery } = useUtmAttribution()

  nuxtApp.hook('app:suspense:resolve', () => {
    captureUtmFromQuery(router.currentRoute.value.query)
  })

  router.afterEach((to) => {
    if (nuxtApp.isHydrating) {
      return
    }

    captureUtmFromQuery(to.query)
  })
})
