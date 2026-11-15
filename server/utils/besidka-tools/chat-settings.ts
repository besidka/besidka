import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

type DbClient = ReturnType<typeof useDb>

export interface BesidkaChatSettings {
  enabled: boolean
  alwaysAllowTools: Record<string, string>
}

export const DEFAULT_BESIDKA_CHAT_SETTINGS: BesidkaChatSettings = {
  enabled: true,
  alwaysAllowTools: {},
}

function isGrantMap(value: unknown): value is Record<string, string> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(hash => typeof hash === 'string')
}

/**
 * The Besidka row of a chat: whether the model gets Besidka tools in it and
 * the "Allow in this chat" grants (exposed tool name to registry hash). A
 * chat without a row has Besidka on and no grants, so the tools are there
 * from the first message once the user opted in.
 */
export async function readBesidkaChatSettings(
  db: DbClient,
  userId: number,
  chatPublicId: string,
): Promise<BesidkaChatSettings> {
  const [row] = await db.select({
    enabled: schema.besidkaChatSettings.enabled,
    alwaysAllowTools: schema.besidkaChatSettings.alwaysAllowTools,
  })
    .from(schema.besidkaChatSettings)
    .where(and(
      eq(schema.besidkaChatSettings.userId, userId),
      eq(schema.besidkaChatSettings.chatPublicId, chatPublicId),
    ))
    .limit(1)

  if (!row) {
    return { ...DEFAULT_BESIDKA_CHAT_SETTINGS, alwaysAllowTools: {} }
  }

  return {
    enabled: row.enabled,
    alwaysAllowTools: isGrantMap(row.alwaysAllowTools)
      ? { ...row.alwaysAllowTools }
      : {},
  }
}

async function upsertBesidkaChatSettings(
  db: DbClient,
  input: { userId: number, chatPublicId: string } & BesidkaChatSettings,
): Promise<void> {
  await db.insert(schema.besidkaChatSettings)
    .values(input)
    .onConflictDoUpdate({
      target: [
        schema.besidkaChatSettings.userId,
        schema.besidkaChatSettings.chatPublicId,
      ],
      set: {
        enabled: input.enabled,
        alwaysAllowTools: input.alwaysAllowTools,
        updatedAt: new Date(),
      },
    })
}

/**
 * Switches Besidka tools on or off for one chat and keeps the chat's
 * grants as they are.
 */
export async function setBesidkaChatEnabled(
  db: DbClient,
  userId: number,
  chatPublicId: string,
  enabled: boolean,
): Promise<BesidkaChatSettings> {
  const current = await readBesidkaChatSettings(db, userId, chatPublicId)
  const next = { ...current, enabled }

  await upsertBesidkaChatSettings(db, { userId, chatPublicId, ...next })

  return next
}

/**
 * Stores an "Allow in this chat" grant for one Besidka tool, bound to the
 * registry hash it was given for, so a changed tool asks again.
 */
export async function addBesidkaChatGrant(
  db: DbClient,
  userId: number,
  chatPublicId: string,
  grant: { toolName: string, definitionHash: string },
): Promise<void> {
  const current = await readBesidkaChatSettings(db, userId, chatPublicId)

  await upsertBesidkaChatSettings(db, {
    userId,
    chatPublicId,
    enabled: current.enabled,
    alwaysAllowTools: {
      ...current.alwaysAllowTools,
      [grant.toolName]: grant.definitionHash,
    },
  })
}
