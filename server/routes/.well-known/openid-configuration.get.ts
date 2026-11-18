import { defineEventHandler } from 'nuxt/server'
import { runOnceAfterInit } from '~~/server/utils/auth-instance'

export default defineEventHandler((event) => {
  return runOnceAfterInit(
    () => useServerAuth().$context,
    () => useServerAuth().handler(event.req),
    () => dropServerAuth(),
  )
})
