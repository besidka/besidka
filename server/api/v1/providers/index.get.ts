export default defineCachedEventHandler(async () => {
  const { providers } = useRuntimeConfig()

  return providers
}, {
  maxAge: 60 * 60 * 24,
})
