import type { Experimental_DecisionModel } from 'ai'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { isJevRoleSwitchedOn } from '#shared/utils/jev-policy'
import type { JevRoleId, JevRoleSettings } from '#shared/utils/jev-policy'
import {
  createJevDecisionModel,
  readJevApiKey,
} from '~~/server/utils/jev/client'
import { recordJevRoleLog } from '~~/server/utils/jev/logging'
import type { JevLogger } from '~~/server/utils/jev/logging'

type DbClient = ReturnType<typeof useDb>

export interface JevRoleSettingsInput {
  typesafeRoles: JevRoleSettings | null | undefined
  hasTypesafeKey: boolean
}

/**
 * A role runs only with a saved TypeSafe AI key and unless the user switched
 * it off: `null` settings and a missing role id both mean on.
 */
export function isJevRoleEnabled(
  settings: JevRoleSettingsInput,
  role: JevRoleId,
): boolean {
  if (!settings.hasTypesafeKey) {
    return false
  }

  return isJevRoleSwitchedOn(settings.typesafeRoles, role)
}

export async function readJevRoleSettings(input: {
  db: DbClient
  userId: number
}): Promise<JevRoleSettings | null> {
  const row = await input.db.query.userSettings.findFirst({
    where: { userId: input.userId },
    columns: { typesafeRoles: true },
  })

  return row?.typesafeRoles ?? null
}

/**
 * Returns the decrypted TypeSafe AI key when `role` is enabled for the user,
 * else `null`. Reads the key first (one D1 read and a decrypt), and the role
 * settings only when a key exists. A failing read or decryption is logged as
 * `key-error` under the role's log key and also returns `null`, so a role
 * never turns into a failed request.
 */
export async function resolveJevRoleApiKey(input: {
  db: DbClient
  userId: number
  role: JevRoleId
  logger?: JevLogger
}): Promise<string | null> {
  try {
    const apiKey = await readJevApiKey(input)

    if (!apiKey) {
      return null
    }

    const typesafeRoles = await readJevRoleSettings(input)
    const isEnabled = isJevRoleEnabled(
      { typesafeRoles, hasTypesafeKey: true },
      input.role,
    )

    return isEnabled ? apiKey : null
  } catch {
    recordJevRoleLog(input.role, { status: 'key-error' }, input.logger)

    return null
  }
}

/**
 * The pinned Jev decision model for `role`, or `null` when the user has no
 * TypeSafe AI key, switched the role off, or the key could not be read.
 * Pass the model to `jevDecide`.
 */
export async function resolveJevRoleModel(input: {
  db: DbClient
  userId: number
  role: JevRoleId
  logger?: JevLogger
}): Promise<Experimental_DecisionModel | null> {
  const apiKey = await resolveJevRoleApiKey(input)

  return apiKey ? createJevDecisionModel(apiKey) : null
}

/**
 * The `user_settings.typesafe_roles` value for a settings PATCH. A role
 * object is merged into the stored one inside SQLite (`json_patch`), so two
 * toggles saved at the same time cannot drop each other; `null` resets every
 * role to on.
 */
export function jevRoleSettingsUpdateValue(
  patch: JevRoleSettings | null,
): SQL | null {
  if (patch === null) {
    return null
  }

  const stored = sql`coalesce(${schema.userSettings.typesafeRoles}, '{}')`

  return sql`json_patch(${stored}, ${JSON.stringify(patch)})`
}
