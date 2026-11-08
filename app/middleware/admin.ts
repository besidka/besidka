export default defineNuxtRouteMiddleware(async () => {
  const { features, refreshFeatures } = useFeatures()

  if (import.meta.client && !features.value) {
    await refreshFeatures()
  }

  if (features.value?.isAdmin === true) {
    return
  }

  return abortNavigation(createError({
    statusCode: 404,
    statusMessage: 'Page not found',
    fatal: true,
  }))
})
