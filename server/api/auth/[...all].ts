export default defineEventHandler((event) => {
  return useServerAuth(event).handler(toWebRequest(event))
})
