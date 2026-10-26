import { defineEventHandler } from 'nuxt/server'
import {
  readLegalConsent,
  toLegalConsentState,
} from '~~/server/utils/legal/consent'

export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)

  return toLegalConsentState(await readLegalConsent(userId))
})
