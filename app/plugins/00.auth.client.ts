export default defineNuxtPlugin(async (nuxtApp) => {
  if (!nuxtApp.payload.serverRendered) {
    // Force fetch for SPA navigation
    await useAuth().fetchSession()
  } else if (
    Boolean(nuxtApp.payload.prerenderedAt)
    || Boolean(nuxtApp.payload.isCached)
  ) {
    // To avoid hydration mismatch, force fetch after mount
    nuxtApp.hook('app:mounted', async () => {
      await useAuth().fetchSession()
    })
  }
})
