import type { GatewayId } from '#shared/types/gateways.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { JevRoleSettings } from '#shared/utils/jev-policy'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import * as schema from '~~/server/db/schema'
import { jevRoleSettingsUpdateValue } from '~~/server/utils/jev/roles'
import { claimExtractionEnableCooldown } from '~~/server/utils/memory/extraction-enable-cooldown'

type DbClient = ReturnType<typeof useDb>

export interface UserSettingsFieldUpdates {
  reasoningExpanded?: boolean
  reasoningAutoHide?: boolean
  defaultReasoningLevel?: ReasoningLevel | null
  allowExternalLinks?: boolean | null
  notificationPromptState?: boolean | null
  sidebarPinned?: boolean
  favoriteModels?: string[]
  favoriteGatewayModels?: Partial<Record<GatewayId, string[]>>
  memoryEnabled?: boolean
  memoryExtractionEnabled?: boolean
  chatSearchEnabled?: boolean
  aboutMe?: null
  profileMemoryModel?: string | null
  profileMemoryGateway?: GatewayId | null
  projectMemoryModel?: string | null
  projectMemoryGateway?: GatewayId | null
  typesafeRoles?: JevRoleSettings | null
}

export function dedupeFavoriteGatewayModels(
  favoriteGatewayModels: Partial<Record<GatewayId, string[] | undefined>>,
): Partial<Record<GatewayId, string[]>> {
  const deduped: Partial<Record<GatewayId, string[]>> = {}

  for (const [gatewayId, modelIds] of Object.entries(favoriteGatewayModels)) {
    if (!modelIds) {
      continue
    }

    deduped[gatewayId as GatewayId] = [...new Set(modelIds)]
  }

  return deduped
}

/**
 * Writes validated settings fields for a user: the upsert of the
 * `user_settings` row, the chat restamp and the extraction-enable cooldown
 * when the update turns automatic memory extraction on, the restamp of the
 * cut-over of every project set to automatic updates `on` when it turns
 * account memory back on (so messages written while memory was off are never
 * read by the background sweep), and the cancellation of a running memory
 * backfill when it turns memory or extraction off.
 */
export async function applyUserSettingsUpdate(input: {
  db: DbClient
  userId: number
  fieldUpdates: UserSettingsFieldUpdates
}): Promise<void> {
  const { db, userId, fieldUpdates } = input
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
  const isExtractionEffectiveBefore = (existingSettings?.memoryEnabled ?? true)
    && existingSettings?.memoryExtractionEnabled === true
  const isExtractionEffectiveAfter
    = (fieldUpdates.memoryEnabled ?? existingSettings?.memoryEnabled ?? true)
      && (fieldUpdates.memoryExtractionEnabled
        ?? existingSettings?.memoryExtractionEnabled) === true
  const isEnablingExtraction = !isExtractionEffectiveBefore
    && isExtractionEffectiveAfter
  const isMemoryOnBefore = existingSettings?.memoryEnabled ?? true
  const isMemoryOnAfter = fieldUpdates.memoryEnabled ?? isMemoryOnBefore
  const isResumingMemory = !isMemoryOnBefore && isMemoryOnAfter

  if (isEnablingExtraction) {
    await claimExtractionEnableCooldown(userId)
  }

  const stampedAt = new Date()
  const settingsValues = isEnablingExtraction
    ? { ...fieldUpdates, memoryExtractionEnabledAt: stampedAt }
    : fieldUpdates
  const settingsStatement = existingSettings
    ? db.update(schema.userSettings).set(
      fieldUpdates.typesafeRoles === undefined
        ? settingsValues
        : {
          ...settingsValues,
          typesafeRoles: jevRoleSettingsUpdateValue(
            fieldUpdates.typesafeRoles,
          ),
        },
    )
      .where(eq(schema.userSettings.userId, userId))
    : db.insert(schema.userSettings).values({
      userId,
      ...settingsValues,
    })
  const isDisablingBackfillSource = fieldUpdates.memoryEnabled === false
    || fieldUpdates.memoryExtractionEnabled === false
  const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
    settingsStatement,
  ]

  if (isEnablingExtraction) {
    statements.push(
      db.update(schema.chats)
        .set({ memoryExtractedAt: stampedAt })
        .where(and(
          eq(schema.chats.userId, userId),
          or(
            isNull(schema.chats.memoryExtractedAt),
            lt(schema.chats.memoryExtractedAt, schema.chats.activityAt),
          ),
        )),
    )
  }

  if (isResumingMemory) {
    statements.push(
      db.update(schema.projects)
        .set({ memoryAutoUpdateEnabledAt: stampedAt })
        .where(and(
          eq(schema.projects.userId, userId),
          eq(schema.projects.memoryAutoUpdate, 'on'),
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
}
