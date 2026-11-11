import type { ArtifactReportReason } from '#shared/utils/artifacts'
import { createError } from 'evlog'
import { z } from 'zod'
import {
  ARTIFACT_REPORT_DETAILS_MAX,
  ARTIFACT_REPORT_EMAIL_MAX,
  ARTIFACT_REPORT_NAME_MAX,
  ARTIFACT_REPORT_REASONS,
  ARTIFACT_REPORT_URGENT_REASONS,
} from '#shared/utils/artifacts'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import * as schema from '~~/server/db/schema'
import { enforceArtifactReportRateLimit } from '~~/server/utils/artifacts/report-rate-limit'
import { resolveSharedChatArtifact } from '~~/server/utils/artifacts/shared-chat'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const paramsSchema = z.object({
  slug: z.string().min(1).max(64),
  artifactId: z.string().min(1).max(64),
})

const emailSchema = z.email()

const bodySchema = z.object({
  reason: z.enum(ARTIFACT_REPORT_REASONS),
  details: z.string().trim().min(1).max(ARTIFACT_REPORT_DETAILS_MAX),
  reporterName: z.string().trim().max(ARTIFACT_REPORT_NAME_MAX).optional(),
  reporterEmail: z.string().trim().max(ARTIFACT_REPORT_EMAIL_MAX).optional(),
}).superRefine((body, context) => {
  const email = body.reporterEmail

  if (email && !emailSchema.safeParse(email).success) {
    context.addIssue({
      code: 'custom',
      path: ['reporterEmail'],
      message: 'Enter a valid email address',
    })
  }

  if (body.reason === 'csam') {
    return
  }

  if (!body.reporterName) {
    context.addIssue({
      code: 'custom',
      path: ['reporterName'],
      message: 'Your name is required for this kind of report',
    })
  }

  if (!body.reporterEmail) {
    context.addIssue({
      code: 'custom',
      path: ['reporterEmail'],
      message: 'Your email is required for this kind of report',
    })
  }
})

function isUrgentReason(reason: ArtifactReportReason): boolean {
  return (ARTIFACT_REPORT_URGENT_REASONS as readonly string[]).includes(reason)
}

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const params = paramsSchema.safeParse(getDecodedRouterParams(event))

  if (!params.success) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (!body.success) {
    throw createError({
      message: 'Invalid report',
      status: 400,
      why: body.error.issues
        .map((issue) => {
          return issue.message
        })
        .join('; '),
    })
  }

  const session = await useUserSession()
  const reporterUserId = session ? parseInt(session.user.id) : null

  await enforceArtifactReportRateLimit(event, reporterUserId, logger)

  const artifact = await resolveSharedChatArtifact({
    event,
    slug: params.data.slug,
    artifactId: params.data.artifactId,
  })
  const priority = isUrgentReason(body.data.reason) ? 'urgent' : 'normal'

  await useDb().insert(schema.artifactReports).values({
    artifactId: artifact.internalId,
    shareId: null,
    reporterUserId,
    reporterName: body.data.reporterName || null,
    reporterEmail: body.data.reporterEmail || null,
    reason: body.data.reason,
    details: body.data.details,
    status: 'open',
    priority,
  })

  logger.set({
    attributes: {
      artifacts: {
        operation: 'shared-report',
        artifactId: params.data.artifactId,
        chatShareId: artifact.shareId,
        reason: body.data.reason,
        priority,
        signedIn: reporterUserId !== null,
      },
    },
  })

  return { ok: true }
})
