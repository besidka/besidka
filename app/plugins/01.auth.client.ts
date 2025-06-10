export default defineNuxtPlugin(() => {
  const auth = useClientAuth()

  return {
    provide: {
      auth,
    },
  }
})
