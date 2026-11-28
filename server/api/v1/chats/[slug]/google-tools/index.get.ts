import { defineEventHandler } from 'nuxt/server'
import { readBesidkaChatSettings } from '~~/server/utils/besidka-tools/chat-settings'
import {
  requireGoogleChatToolsAccess,
  toGoogleChatServiceStates,
} from '~~/server/utils/google/chat-tools-route'

/**
 * Which Google services this chat gives the model tools for: `drive`,
 * `gmail` and `calendar`, each true while the service is on. A chat with no
 * stored choice answers true for all three.
 */
export default defineEventHandler(async (event) => {
  const { userId, chatPublicId } = await requireGoogleChatToolsAccess(event, {
    write: false,
  })
  const settings = await readBesidkaChatSettings(
    useDb(),
    userId,
    chatPublicId,
  )

  return toGoogleChatServiceStates(settings.googleServicesOff)
})
