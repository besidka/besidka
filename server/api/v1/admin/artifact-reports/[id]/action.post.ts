import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import {
  ARTIFACT_REPORT_ACTION_SCOPES,
  ARTIFACT_REPORT_ACTIONS,
  ARTIFACT_TAKEDOWN_STATEMENT_MAX,
  ARTIFACT_TAKEDOWN_STATEMENT_MIN,
} from '#shared/utils/artifacts'
import { decideArtifactReport } from '~~/server/utils/artifacts/takedown'
import {
  createFeatureAdminWriteContext,
  readAdminIdParam,
  throwInvalidAdminBody,
} from '~~/server/utils/features/admin-request'
import { requireAdmin } from '~~/server/utils/features/guards'

const bodySchema = z.object({
  action: z.enum(ARTIFACT_REPORT_ACTIONS),
  statement: z.string()
    .trim()
    .min(ARTIFACT_TAKEDOWN_STATEMENT_MIN)
    .max(ARTIFACT_TAKEDOWN_STATEMENT_MAX),
  scope: z.enum(ARTIFACT_REPORT_ACTION_SCOPES),
})

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)
  const reportId = readAdminIdParam(event)
  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throwInvalidAdminBody(body.error.message)
  }

  event.res.headers.set('Cache-Control', 'private, no-store')

  return await decideArtifactReport(context, {
    reportId,
    ...body.data,
  })
})
