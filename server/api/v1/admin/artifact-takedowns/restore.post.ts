import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import { restoreArtifactTakedown } from '~~/server/utils/artifacts/takedown'
import {
  createFeatureAdminWriteContext,
  throwInvalidAdminBody,
} from '~~/server/utils/features/admin-request'
import { requireAdmin } from '~~/server/utils/features/guards'

const bodySchema = z.object({
  artifactId: z.string().trim().min(1).max(64).optional(),
  shareId: z.string().trim().min(1).max(80).optional(),
}).refine((body) => {
  return Boolean(body.artifactId) !== Boolean(body.shareId)
}, { message: 'Pass exactly one of artifactId or shareId' })

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)
  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throwInvalidAdminBody(body.error.message)
  }

  event.res.headers.set('Cache-Control', 'private, no-store')

  return await restoreArtifactTakedown(context, body.data)
})
