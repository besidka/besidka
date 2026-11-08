import { createError } from 'evlog'
import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import { requireAdmin } from '~~/server/utils/features/guards'
import { logFeatureAdminRead } from '~~/server/utils/features/admin'
import { listAdminAuditLog } from '~~/server/utils/features/admin-queries'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  event.res.headers.set('Cache-Control', 'private, no-store')

  const query = await getValidatedQuery(event, z.object({
    cursor: z.coerce.number().int().positive().optional(),
    flag: z.string().trim().min(1).max(100).optional(),
    targetUserId: z.coerce.number().int().positive().optional(),
  }).safeParse)

  if (query.error) {
    throw createError({
      message: 'Invalid query',
      status: 400,
      why: query.error.message,
    })
  }

  const result = await listAdminAuditLog(useDb(), query.data)

  logFeatureAdminRead(
    useRequestLogger(event),
    'audit',
    result.entries.length,
  )

  return result
})
