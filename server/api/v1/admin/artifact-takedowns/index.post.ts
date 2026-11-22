import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import {
  ARTIFACT_TAKEDOWN_SCOPES,
  ARTIFACT_TAKEDOWN_STATEMENT_MAX,
  ARTIFACT_TAKEDOWN_STATEMENT_MIN,
} from '#shared/utils/artifacts'
import { takeDownArtifactTarget } from '~~/server/utils/artifacts/takedown'
import {
  createFeatureAdminWriteContext,
  throwInvalidAdminBody,
} from '~~/server/utils/features/admin-request'
import { requireAdmin } from '~~/server/utils/features/guards'

const TARGET_MAX_LENGTH = 2048

const bodySchema = z.object({
  target: z.string().trim().min(1).max(TARGET_MAX_LENGTH),
  statement: z.string()
    .trim()
    .min(ARTIFACT_TAKEDOWN_STATEMENT_MIN)
    .max(ARTIFACT_TAKEDOWN_STATEMENT_MAX),
  scope: z.enum(ARTIFACT_TAKEDOWN_SCOPES),
  legalHold: z.boolean().optional().default(false),
})

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)
  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throwInvalidAdminBody(body.error.message)
  }

  event.res.headers.set('Cache-Control', 'private, no-store')

  return await takeDownArtifactTarget(context, body.data)
})
