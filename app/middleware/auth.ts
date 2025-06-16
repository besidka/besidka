export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) {
    return
  }

  // const { $auth } = useNuxtApp()
  // const { data: session } = await $auth.useSession(useFetch)

  // if (session.value) {
  //   return
  // }

  // return navigateTo('/signin')
})
