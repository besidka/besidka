import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { readValidatedBody } from 'nuxt/server'
import type { z } from 'zod'
import { CONNECTOR_REQUEST_BODY_MAX_BYTES } from '#shared/utils/connectors-policy'
import { assertRequestBodyLength } from '~~/server/utils/artifacts/viewer-storage-request'
import { assertNotCrossSiteRequest } from '~~/server/utils/cross-site-guard'

/**
 * Reads a connector route body: refuses a cross-site request and a body
 * over 8 KiB before parsing, and never echoes the input in the error (a
 * header value or URL in it can be a secret).
 */
export async function readConnectorBody<Schema extends z.ZodType>(
  event: RequestEvent,
  schema: Schema,
): Promise<z.infer<Schema>> {
  assertNotCrossSiteRequest(event)
  assertRequestBodyLength(event, CONNECTOR_REQUEST_BODY_MAX_BYTES)

  const body = await readValidatedBody(event, schema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request',
      status: 400,
      why: 'The request body does not match the expected fields',
      fix: 'Check the request fields',
    })
  }

  return body.data as z.infer<Schema>
}
