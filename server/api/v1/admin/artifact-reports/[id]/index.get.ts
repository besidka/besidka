import { defineEventHandler } from 'nuxt/server'
import { getArtifactReportForAdmin } from '~~/server/utils/artifacts/takedown'
import { logFeatureAdminRead } from '~~/server/utils/features/admin'
import { readAdminIdParam } from '~~/server/utils/features/admin-request'
import { requireAdmin } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  event.res.headers.set('Cache-Control', 'private, no-store')
  event.res.headers.set('Referrer-Policy', 'no-referrer')

  const report = await getArtifactReportForAdmin({
    db: useDb(),
    reportId: readAdminIdParam(event),
  })

  logFeatureAdminRead(useRequestLogger(event), 'artifact-report', 1)

  return report
})
