import { defineEventHandler } from 'nuxt/server'
import { readBesidkaChatSettings } from '~~/server/utils/besidka-tools/chat-settings'
import { requireBesidkaChatAccess } from '~~/server/utils/besidka-tools/route'

/**
 * Whether this chat gives the model Besidka tools. On by default, so a chat
 * without a stored choice answers `true`.
 */
export default defineEventHandler(async (event) => {
  const { userId, chatPublicId } = await requireBesidkaChatAccess(event, {
    write: false,
  })
  const settings = await readBesidkaChatSettings(
    useDb(),
    userId,
    chatPublicId,
  )

  return { enabled: settings.enabled }
})
