import { defineEventHandler } from 'nuxt/server'
import { retryOnEndedRequestPromise } from '~~/server/utils/auth-instance'

export default defineEventHandler((event) => {
  return retryOnEndedRequestPromise(() => {
    return useServerAuth().handler(event.req)
  }, () => dropServerAuth(), () => !event.req.bodyUsed)
})
