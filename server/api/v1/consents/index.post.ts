import { createError } from 'evlog'
import type {
  ModuleOptions,
} from '~~/modules/cookie-consent/src/runtime/types/module'
import {
  deriveConsentDecision,
  parseConsentCookieValue,
} from '~~/server/utils/consents'
import { insertConsentReceipt } from '~~/server/utils/consents-db'
import {
  defineEventHandler,
  getCookie,
  getRequestHeader,
  readValidatedBody,
  setResponseStatus,
} from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  const body = await readValidatedBody(event, z.object({
    id: z.string().max(64),
    date: z.string().datetime(),
    revision: z.number().int().nonnegative(),
    granted: z.array(z.string().max(24)).max(16),
    denied: z.array(z.string().max(24)).max(16),
    changed: z.array(z.string().max(24)).max(16),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid consent receipt body',
      status: 400,
      why: body.error.message,
      fix: 'Provide id, date, revision, granted, denied, and changed fields',
    })
  }

  const { id, date, revision, granted, denied, changed } = body.data

  const config = useRuntimeConfig()
  const cookieConsentOptions = config.public.cookieConsent as ModuleOptions

  const rawCookie = getCookie(event, cookieConsentOptions.cookieName)
  const parsedCookie = parseConsentCookieValue(rawCookie)

  const cookiePresent = parsedCookie !== null

  let consistent = false

  if (cookiePresent && parsedCookie) {
    const cookieGrantedSet = new Set(parsedCookie.granted)
    const bodyGrantedSet = new Set(granted)
    const setsMatch = cookieGrantedSet.size === bodyGrantedSet.size
      && [...cookieGrantedSet].every(item => bodyGrantedSet.has(item))

    consistent = parsedCookie.id === id && setsMatch
  }

  const decision = deriveConsentDecision(
    granted,
    cookieConsentOptions.categories,
  )

  logger.set({
    consent: {
      id,
      date,
      revision,
      granted,
      denied,
      changed,
      decision,
      cookiePresent,
      consistent,
    },
  })

  logger.audit?.({
    action: 'consent.receipt',
    actor: { id, type: 'user' },
    target: { id: 'cookie-consent', type: 'consent' },
  })

  const country = getRequestHeader(event, 'cf-ipcountry') ?? null

  await insertConsentReceipt({
    id,
    createdAt: date,
    revision,
    granted,
    denied,
    changed,
    decision,
    consistent,
    country,
  }, logger)

  setResponseStatus(event, 204)

  return null
})
