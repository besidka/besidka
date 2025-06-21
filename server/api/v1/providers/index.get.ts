export default defineCachedEventHandler(async (event) => {
  const { providers } = useRuntimeConfig(event)

  return providers
}, {
  maxAge: 60 * 60,
})
