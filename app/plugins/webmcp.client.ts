export default defineNuxtPlugin((nuxtApp): void => {
  const modelContext = resolveWebMcpModelContext()

  if (!modelContext) {
    return
  }

  const controller = new AbortController()

  nuxtApp.vueApp.onUnmount(() => {
    controller.abort()
  })

  const tools = createWebMcpTools({
    origin: window.location.origin,
    listKeyGuides: () => {
      return nuxtApp.runWithContext(() => {
        return queryCollection('keyGuides')
          .select('path', 'title')
          .order('path', 'ASC')
          .all()
      })
    },
    navigate: async (path) => {
      await nuxtApp.runWithContext(() => navigateTo(path))
    },
  })

  registerWebMcpTools(modelContext, tools, controller.signal)
})
