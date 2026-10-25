import { createError } from 'evlog'
import type { GatewayId } from '#shared/types/gateways.d'
import type {
  ComplianceBlockedCounts,
  MemorySensitiveCategory,
} from '#shared/types/memory.d'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import * as schema from '~~/server/db/schema'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import {
  SENSITIVE_TOPIC_REFUSAL_MESSAGE,
  neverStoreKinds,
} from '#shared/utils/memory-policy'
import {
  memorySettingsPatchShape,
  refineMemorySettingsPatch,
} from '#shared/utils/memory-schemas'
import { enforceGatewayModelsRateLimit } from '~~/server/utils/gateways/catalog-rate-limit'
import {
  detectNeverStore,
  recordBlockedCounts,
} from '~~/server/utils/memory/compliance'
import { classifySensitiveCategories } from '~~/server/utils/memory/sensitivity'
import { assertMemoryModelChoice } from '~~/server/utils/memory/validate-model-choice'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const favoriteGatewayModelIds = z.array(z.string().max(100)).max(50)

const memoryModelScopes = [
  {
    modelKey: 'profileMemoryModel',
    gatewayKey: 'profileMemoryGateway',
  },
  {
    modelKey: 'projectMemoryModel',
    gatewayKey: 'projectMemoryGateway',
  },
] as const

interface MemoryModelChoiceToValidate {
  model: string
  gateway: GatewayId | null
}

function assertAboutMeStorable(
  aboutMe: string,
  logger: { set: (fields: Record<string, unknown>) => void },
): void {
  const matches = detectNeverStore(aboutMe)

  if (!matches.length) {
    return
  }

  const blocked: ComplianceBlockedCounts = {}

  for (const match of matches) {
    blocked[match.kind] = (blocked[match.kind] ?? 0) + 1
  }

  recordBlockedCounts(blocked, logger, 'settings-about-me')

  const kindLabels = neverStoreKinds
    .filter((kind) => {
      return blocked[kind.id] !== undefined
    })
    .map((kind) => {
      return `${kind.label} (${kind.id})`
    })

  throw createError({
    message: 'About me contains data that cannot be stored',
    status: 400,
    why: `Detected: ${kindLabels.join(', ')}.`,
    fix: 'Remove the flagged data from "About me" and save again.',
  })
}

function assertAboutMeHasNoSpecialCategories(
  aboutMe: string,
  logger: { set: (fields: Record<string, unknown>) => void },
): void {
  const categories: MemorySensitiveCategory[]
    = classifySensitiveCategories(aboutMe)

  if (!categories.length) {
    return
  }

  logger.set({
    attributes: {
      memoryCompliance: {
        sensitive: {
          origin: 'settings-about-me',
          categories,
          categoryCount: categories.length,
        },
      },
    },
  })

  throw createError({
    message: SENSITIVE_TOPIC_REFUSAL_MESSAGE,
    status: 422,
    why: `Your "About me" text looks like sensitive data (${categories.join(', ')}).`,
    fix: 'Remove the sensitive details from "About me" and save again.',
  })
}

export default defineEventHandler(async (event) => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const body = await readValidatedBody(event, z.object({
    reasoningExpanded: z.boolean().optional(),
    reasoningAutoHide: z.boolean().optional(),
    allowExternalLinks: z.boolean().nullable().optional(),
    notificationPromptState: z.boolean().nullable().optional(),
    sidebarPinned: z.boolean().optional(),
    favoriteModels: z.array(z.string().max(100)).max(50).optional(),
    favoriteGatewayModels: z.object({
      vercel: favoriteGatewayModelIds.optional(),
      cloudflare: favoriteGatewayModelIds.optional(),
      openrouter: favoriteGatewayModelIds.optional(),
    }).optional(),
    ...memorySettingsPatchShape,
  }).superRefine(refineMemorySettingsPatch).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const db = useDb()
  const userId = parseInt(session.user.id)
  const logger = useRequestLogger(event)

  const fieldUpdates: {
    reasoningExpanded?: boolean
    reasoningAutoHide?: boolean
    allowExternalLinks?: boolean | null
    notificationPromptState?: boolean | null
    sidebarPinned?: boolean
    favoriteModels?: string[]
    favoriteGatewayModels?: Partial<Record<GatewayId, string[]>>
    memoryEnabled?: boolean
    memoryExtractionEnabled?: boolean
    chatSearchEnabled?: boolean
    aboutMe?: string | null
    profileMemoryModel?: string | null
    profileMemoryGateway?: GatewayId | null
    projectMemoryModel?: string | null
    projectMemoryGateway?: GatewayId | null
  } = {}

  if (body.data.reasoningExpanded !== undefined) {
    fieldUpdates.reasoningExpanded = body.data.reasoningExpanded
  }

  if (body.data.reasoningAutoHide !== undefined) {
    fieldUpdates.reasoningAutoHide = body.data.reasoningAutoHide
  }

  if ('allowExternalLinks' in body.data) {
    fieldUpdates.allowExternalLinks = body.data.allowExternalLinks ?? null
  }

  if ('notificationPromptState' in body.data) {
    fieldUpdates.notificationPromptState
      = body.data.notificationPromptState ?? null
  }

  if (body.data.sidebarPinned !== undefined) {
    fieldUpdates.sidebarPinned = body.data.sidebarPinned
  }

  if (body.data.favoriteModels !== undefined) {
    fieldUpdates.favoriteModels = [...new Set(body.data.favoriteModels)]
  }

  if (body.data.favoriteGatewayModels !== undefined) {
    const deduped: Partial<Record<GatewayId, string[]>> = {}

    for (const [gatewayId, modelIds] of Object.entries(
      body.data.favoriteGatewayModels,
    )) {
      if (!modelIds) {
        continue
      }

      deduped[gatewayId as GatewayId] = [...new Set(modelIds)]
    }

    fieldUpdates.favoriteGatewayModels = deduped
  }

  if (body.data.memoryEnabled !== undefined) {
    fieldUpdates.memoryEnabled = body.data.memoryEnabled
  }

  if (body.data.memoryExtractionEnabled !== undefined) {
    fieldUpdates.memoryExtractionEnabled = body.data.memoryExtractionEnabled
  }

  if (body.data.chatSearchEnabled !== undefined) {
    fieldUpdates.chatSearchEnabled = body.data.chatSearchEnabled
  }

  if (body.data.aboutMe !== undefined) {
    const aboutMe = body.data.aboutMe?.trim() || null

    if (aboutMe) {
      assertAboutMeStorable(aboutMe, logger)
      assertAboutMeHasNoSpecialCategories(aboutMe, logger)
    }

    fieldUpdates.aboutMe = aboutMe
  }

  const memoryModelChoices: MemoryModelChoiceToValidate[] = []

  for (const { modelKey, gatewayKey } of memoryModelScopes) {
    const model = body.data[modelKey]
    const gateway = body.data[gatewayKey]

    if (gateway !== undefined && model === undefined) {
      throw createError({
        message: 'Invalid request body',
        status: 400,
        why: `${gatewayKey} was sent without ${modelKey}.`,
        fix: `Send ${modelKey} together with its gateway.`,
      })
    }

    if (model === undefined) {
      continue
    }

    fieldUpdates[modelKey] = model
    fieldUpdates[gatewayKey] = model === null ? null : (gateway ?? null)

    if (model !== null) {
      memoryModelChoices.push({
        model,
        gateway: gateway ?? null,
      })
    }
  }

  if (Object.keys(fieldUpdates).length === 0) {
    throw createError({
      message: 'No fields to update',
      status: 400,
    })
  }

  for (const { model, gateway } of memoryModelChoices) {
    if (gateway !== null) {
      await enforceGatewayModelsRateLimit(event, session.user.id)
    }

    await assertMemoryModelChoice({ userId, model, gateway, logger })
  }

  const existingSettings = await db.query.userSettings.findFirst({
    where: {
      userId,
    },
    columns: {
      id: true,
      memoryEnabled: true,
      memoryExtractionEnabled: true,
    },
  })
  const settingsStatement = existingSettings
    ? db.update(schema.userSettings).set(fieldUpdates)
      .where(eq(schema.userSettings.userId, userId))
    : db.insert(schema.userSettings).values({
      userId,
      ...fieldUpdates,
    })
  const isExtractionEffectiveBefore = (existingSettings?.memoryEnabled ?? true)
    && existingSettings?.memoryExtractionEnabled === true
  const isExtractionEffectiveAfter
    = (fieldUpdates.memoryEnabled ?? existingSettings?.memoryEnabled ?? true)
      && (fieldUpdates.memoryExtractionEnabled
        ?? existingSettings?.memoryExtractionEnabled) === true
  const isEnablingExtraction = !isExtractionEffectiveBefore
    && isExtractionEffectiveAfter
  const isDisablingBackfillSource = fieldUpdates.memoryEnabled === false
    || fieldUpdates.memoryExtractionEnabled === false
  const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
    settingsStatement,
  ]

  if (isEnablingExtraction) {
    const stampedAt = new Date()

    statements.push(
      db.update(schema.chats)
        .set({ memoryExtractedAt: stampedAt })
        .where(and(
          eq(schema.chats.userId, userId),
          or(
            isNull(schema.chats.memoryExtractedAt),
            lt(schema.chats.memoryExtractedAt, stampedAt),
          ),
        )),
    )
  }

  if (statements.length === 1) {
    await settingsStatement
  } else {
    await db.batch(statements)
  }

  if (isDisablingBackfillSource) {
    await db.update(schema.memoryBackfillJobs)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(and(
        eq(schema.memoryBackfillJobs.userId, userId),
        eq(schema.memoryBackfillJobs.status, 'running'),
      ))
  }

  return fieldUpdates
})
