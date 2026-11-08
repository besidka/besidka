import { createError } from 'evlog'
import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import { ADMIN_USER_SEARCH_MIN_LENGTH } from '#shared/utils/features/admin-schemas'
import { requireAdmin } from '~~/server/utils/features/guards'
import { logFeatureAdminRead } from '~~/server/utils/features/admin'
import { searchAdminUsers } from '~~/server/utils/features/admin-queries'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)

  event.res.headers.set('Cache-Control', 'private, no-store')

  const query = await getValidatedQuery(event, z.object({
    q: z.string().trim().min(ADMIN_USER_SEARCH_MIN_LENGTH).max(100),
  }).safeParse)

  if (query.error) {
    throw createError({
      message: `Type at least ${ADMIN_USER_SEARCH_MIN_LENGTH} characters`,
      status: 400,
      why: 'search_query_invalid',
    })
  }

  const users = await searchAdminUsers(
    useDb(),
    query.data.q,
    adminContext.config,
  )

  logFeatureAdminRead(useRequestLogger(event), 'user_search', users.length)

  return { users }
})
