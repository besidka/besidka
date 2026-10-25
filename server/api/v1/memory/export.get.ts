import { defineEventHandler } from 'nuxt/server'
import { buildMemoryExport } from '~~/server/utils/memory/entries'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)

  logger.set({ userId })

  const memoryExport = await buildMemoryExport({ db: useDb(), userId })

  logger.set({
    attributes: {
      memoryExport: {
        entries: memoryExport.entries.length,
        projects: memoryExport.projects.length,
      },
    },
  })

  applyResponseHeaders(event, {
    'Content-Disposition': 'attachment; filename="besidka-memory-export-'
      + `${memoryExport.exportedAt.slice(0, 10)}.json"`,
    'Cache-Control': 'no-store',
  })

  return memoryExport
})
