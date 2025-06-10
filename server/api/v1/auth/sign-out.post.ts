export default defineEventHandler(async (event) => {
  return await useServerAuth().api.signOut({
    // @ts-ignore
    headers: getHeaders(event),
    asResponse: true,
  })
})
