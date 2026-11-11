import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
import { z } from 'zod'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'

const documentParamsSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
})

export function createDocumentNotFoundError() {
  return createError({
    message: 'Document not found',
    status: 404,
    why: 'No document of this account has this id',
    fix: 'Check the document link',
  })
}

export function parseDocumentIdParam(event: RequestEvent): string {
  const params = documentParamsSchema.safeParse(getDecodedRouterParams(event))

  if (!params.success) {
    throw createError({
      message: 'Invalid document id',
      status: 400,
      why: params.error.message,
      fix: 'Use the id the document status route returned',
    })
  }

  return params.data.id
}

export function parseSessionUserId(session: {
  user: { id: string | number }
}): number {
  return parseInt(String(session.user.id))
}
