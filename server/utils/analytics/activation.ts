import { and, eq, inArray } from 'drizzle-orm'
import { getOAuthState } from 'better-auth/api'
import type { ActivationEventName } from '#shared/types/analytics.d'
import type { UtmParams } from '#shared/utils/utm'
import { extractUtmFromUrl, hasUtmParams } from '#shared/utils/utm'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { resolveServerLogger } from '~~/server/utils/files/logger'
import { toUtmBlobs } from '~~/server/utils/analytics/utm-blobs'

type Db = ReturnType<typeof useDb>

export type ActivationOutcome = 'fired' | 'skipped' | 'failed'

interface SignupHookContext {
  body?: unknown
}

const SIGNUP_EVENT: ActivationEventName = 'signup_completed'

function readCallbackUrl(source: unknown): string | undefined {
  if (!source || typeof source !== 'object') {
    return undefined
  }

  const callbackUrl = (source as { callbackURL?: unknown }).callbackURL

  return typeof callbackUrl === 'string' ? callbackUrl : undefined
}

async function readOAuthStateCallbackUrl(): Promise<string | undefined> {
  try {
    return readCallbackUrl(await getOAuthState())
  } catch {
    return undefined
  }
}

export async function resolveSignupUtm(
  context: SignupHookContext | null | undefined,
): Promise<UtmParams> {
  const bodyUtm = extractUtmFromUrl(readCallbackUrl(context?.body))

  if (hasUtmParams(bodyUtm)) {
    return bodyUtm
  }

  return extractUtmFromUrl(await readOAuthStateCallbackUrl())
}

async function claimActivationEvent(
  db: Db,
  userId: number,
  event: ActivationEventName,
  provider: string | undefined,
): Promise<boolean> {
  const claimed = await db.insert(schema.userActivationEvents)
    .values({
      userId,
      event,
      provider: provider ?? null,
    })
    .onConflictDoNothing()
    .returning({ userId: schema.userActivationEvents.userId })

  return claimed.length > 0
}

async function saveUserAttribution(
  db: Db,
  userId: number,
  utm: UtmParams,
): Promise<void> {
  if (!hasUtmParams(utm)) {
    return
  }

  await db.insert(schema.userAttribution)
    .values({
      userId,
      utmSource: utm.source ?? null,
      utmMedium: utm.medium ?? null,
      utmCampaign: utm.campaign ?? null,
      utmContent: utm.content ?? null,
    })
    .onConflictDoNothing()
}

async function readUserAttribution(
  db: Db,
  userId: number,
): Promise<UtmParams> {
  const [attribution] = await db.select({
    source: schema.userAttribution.utmSource,
    medium: schema.userAttribution.utmMedium,
    campaign: schema.userAttribution.utmCampaign,
    content: schema.userAttribution.utmContent,
  })
    .from(schema.userAttribution)
    .where(eq(schema.userAttribution.userId, userId))
    .limit(1)

  if (!attribution) {
    return {}
  }

  return {
    ...(attribution.source && { source: attribution.source }),
    ...(attribution.medium && { medium: attribution.medium }),
    ...(attribution.campaign && { campaign: attribution.campaign }),
    ...(attribution.content && { content: attribution.content }),
  }
}

async function readRecordedEvents(
  db: Db,
  userId: number,
  event: ActivationEventName,
): Promise<Set<ActivationEventName>> {
  const recordedEvents = await db.select({
    event: schema.userActivationEvents.event,
  })
    .from(schema.userActivationEvents)
    .where(and(
      eq(schema.userActivationEvents.userId, userId),
      inArray(schema.userActivationEvents.event, [SIGNUP_EVENT, event]),
    ))

  return new Set(recordedEvents.map((recordedEvent) => {
    return recordedEvent.event
  }))
}

async function isEligibleForFirstEvent(
  db: Db,
  userId: number,
  event: ActivationEventName,
): Promise<boolean> {
  const recordedEvents = await readRecordedEvents(db, userId, event)

  return recordedEvents.has(SIGNUP_EVENT) && !recordedEvents.has(event)
}

function writeActivationDataPoint(
  event: ActivationEventName,
  utm: UtmParams,
  provider: string | undefined,
): void {
  const analytics = useAnalytics()

  if (!analytics) {
    return
  }

  const [campaign, source, medium] = toUtmBlobs(utm)

  analytics.writeDataPoint({
    blobs: [event, campaign, source, medium, provider ?? ''],
    doubles: [1],
    indexes: [event],
  })
}

function logActivation(
  event: ActivationEventName,
  utm: UtmParams,
  provider: string | undefined,
  logger: LoggerLike,
): void {
  logger.set({
    analytics: { event },
    attributes: {
      ...(hasUtmParams(utm) && { utm }),
      ...(provider && { activation: { provider } }),
    },
  })
}

function logActivationError(
  event: ActivationEventName,
  exception: unknown,
  logger: LoggerLike,
): void {
  logger.set({
    attributes: {
      analytics: {
        error: exceptionMessage(exception),
        event,
      },
    },
  })
}

function emitActivation(
  event: ActivationEventName,
  utm: UtmParams,
  provider: string | undefined,
  logger: LoggerLike,
): void {
  writeActivationDataPoint(event, utm, provider)
  logActivation(event, utm, provider, logger)
}

async function recordFirstActivation(
  userId: number,
  event: ActivationEventName,
  provider: string,
  logger: LoggerLike,
): Promise<ActivationOutcome> {
  try {
    const db = useDb()

    if (!await isEligibleForFirstEvent(db, userId, event)) {
      return 'skipped'
    }

    const utm = await readUserAttribution(db, userId)

    if (!await claimActivationEvent(db, userId, event, provider)) {
      return 'skipped'
    }

    emitActivation(event, utm, provider, logger)

    return 'fired'
  } catch (exception) {
    logActivationError(event, exception, logger)

    return 'failed'
  }
}

export async function recordSignupActivation(
  userId: number,
  utm: UtmParams,
  logger?: LoggerLike,
): Promise<ActivationOutcome> {
  const activationLogger = resolveServerLogger(logger)

  try {
    const db = useDb()

    await saveUserAttribution(db, userId, utm)

    if (!await claimActivationEvent(db, userId, SIGNUP_EVENT, undefined)) {
      return 'skipped'
    }

    emitActivation(SIGNUP_EVENT, utm, undefined, activationLogger)

    return 'fired'
  } catch (exception) {
    logActivationError(SIGNUP_EVENT, exception, activationLogger)

    return 'failed'
  }
}

export async function recordFirstProviderKeyActivation(
  userId: number,
  provider: string,
  logger?: LoggerLike,
): Promise<ActivationOutcome> {
  return recordFirstActivation(
    userId,
    'first_provider_key_added',
    provider,
    resolveServerLogger(logger),
  )
}

export async function recordFirstChatMessageActivation(
  userId: number,
  provider: string,
  logger?: LoggerLike,
): Promise<ActivationOutcome> {
  return recordFirstActivation(
    userId,
    'first_chat_message',
    provider,
    resolveServerLogger(logger),
  )
}
