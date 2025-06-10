export default defineEventHandler(async (event) => {
  return await useServerAuth().api.getSession({
    // @ts-ignore
    headers: getHeaders(event),
  })
})
