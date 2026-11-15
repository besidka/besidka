import { defineEventHandler } from 'nuxt/server'
import { runRegistrySyncNow } from '~~/server/utils/connectors/registry-sync-now'
import { createFeatureAdminWriteContext } from '~~/server/utils/features/admin-request'
import { requireAdmin } from '~~/server/utils/features/guards'

/**
 * Admin-only "Sync now": one run of the hourly registry mirror, so a preview
 * (crons do not run there) can be filled. A non-admin gets the same 404 as
 * any unavailable feature. The answer says whether to run again.
 */
export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)

  event.res.headers.set('Cache-Control', 'private, no-store')

  const result = await runRegistrySyncNow({
    db: useDb(),
    kv: useKV(),
    now: new Date(),
    logger: context.logger,
  })

  context.logger.set({
    attributes: {
      registry: {
        syncNow: {
          outcome: result.outcome,
          pages: result.pages,
          upserted: result.upserted,
          rows: result.rows,
          error: result.error,
        },
      },
    },
  })

  return result
})
