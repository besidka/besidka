import { defineEventHandler } from 'nuxt/server'

export default defineEventHandler((event) => {
  return useServerAuth().handler(event.req)
})
