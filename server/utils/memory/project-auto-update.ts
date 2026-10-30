import { and, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

/**
 * SQL twin of `resolveProjectAutoUpdate` for a project chat, shared by the
 * sweep selection and the "chats left for the sweep" settle check so the two
 * can never drift. Reads `chats.activity_at`, `projects.*` and the owner's
 * `user_settings.*`, so the caller must have all three joined. A chat passes
 * when its project is not disabled and either the project is `on` (cut-over
 * recorded, activity after the later of the project stamp and the account
 * stamp while the account switch is on) or the project inherits (account
 * switch on, account stamp recorded, activity after the later of it and the
 * project stamp, which is only set when the project left `off`). `off` never
 * passes.
 * Account-level `memory_enabled`, consent, idle window and backoff stay with
 * the caller.
 */
export function projectChatSweepCondition() {
  const { activityAt } = schema.chats
  const {
    memoryStatus,
    memoryAutoUpdate,
    memoryAutoUpdateEnabledAt,
  } = schema.projects
  const {
    memoryExtractionEnabled,
    memoryExtractionEnabledAt,
  } = schema.userSettings
  const isAccountExtractionOn = sql`coalesce(${memoryExtractionEnabled}, 0) = 1`
  const accountCutOverOrZero = sql`case when ${isAccountExtractionOn} then coalesce(${memoryExtractionEnabledAt}, 0) else 0 end`

  return and(
    ne(memoryStatus, 'disabled'),
    or(
      and(
        eq(memoryAutoUpdate, 'on'),
        isNotNull(memoryAutoUpdateEnabledAt),
        sql`${activityAt} > max(${accountCutOverOrZero}, ${memoryAutoUpdateEnabledAt})`,
      ),
      and(
        isNull(memoryAutoUpdate),
        isAccountExtractionOn,
        isNotNull(memoryExtractionEnabledAt),
        sql`${activityAt} > max(${memoryExtractionEnabledAt}, coalesce(${memoryAutoUpdateEnabledAt}, 0))`,
      ),
    ),
  )
}
