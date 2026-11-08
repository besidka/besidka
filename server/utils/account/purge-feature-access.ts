import type { AnyColumn } from 'drizzle-orm'
import { eq, or, sql } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export const FEATURE_AUDIT_PERSONAL_KEYS = [
  'userId',
  'targetUserId',
  'actorUserId',
  'grantedBy',
  'updatedBy',
  'reason',
] as const

export interface PurgeFeatureAccessResult {
  featureGrantsDeleted: number
  featureOptInsDeleted: number
  userRolesDeleted: number
  featureAuditRowsAnonymised: number
}

type PurgeFeatureAccessDatabase = Pick<
  ReturnType<typeof useDb>,
  'delete' | 'update'
>

function buildJsonScrub(column: AnyColumn) {
  const paths = FEATURE_AUDIT_PERSONAL_KEYS.map((key) => {
    return sql`${`$.${key}`}`
  })

  return sql`case when json_valid(${column})
    then json_remove(${column}, ${sql.join(paths, sql`, `)})
    else null end`
}

function nullWhenEqual(column: AnyColumn, userId: number) {
  return sql`case when ${column} = ${userId} then null else ${column} end`
}

/**
 * Removes a user's feature access rows, which have no foreign key to
 * `users` and so never cascade. Audit rows are kept for the admin's record
 * but lose every link to the person: the actor and target ids are nulled
 * and user ids plus the free-text `reason` are stripped from the top-level
 * keys of `before` and `after` (compliance pre-check C5); a value that is
 * not valid JSON is dropped so it can never block the deletion. Writers keep
 * `before`/`after` flat and put every referenced user in the actor or
 * target column, so this scrub reaches every personal key. Grantor ids the
 * user left on other users' rows are nulled too.
 */
export async function purgeUserFeatureAccess(
  userId: number,
  database: PurgeFeatureAccessDatabase,
): Promise<PurgeFeatureAccessResult> {
  const featureGrants = await database
    .delete(schema.featureGrants)
    .where(eq(schema.featureGrants.userId, userId))
    .returning({ id: schema.featureGrants.id })
  const featureOptIns = await database
    .delete(schema.featureOptIns)
    .where(eq(schema.featureOptIns.userId, userId))
    .returning({ id: schema.featureOptIns.id })
  const userRoles = await database
    .delete(schema.userRoles)
    .where(eq(schema.userRoles.userId, userId))
    .returning({ id: schema.userRoles.id })

  await database
    .update(schema.featureGrants)
    .set({ grantedBy: null })
    .where(eq(schema.featureGrants.grantedBy, userId))
  await database
    .update(schema.userRoles)
    .set({ grantedBy: null })
    .where(eq(schema.userRoles.grantedBy, userId))
  await database
    .update(schema.featureFlagRules)
    .set({ updatedBy: null })
    .where(eq(schema.featureFlagRules.updatedBy, userId))

  const auditLog = schema.featureAuditLog
  const anonymisedAuditRows = await database
    .update(auditLog)
    .set({
      actorUserId: nullWhenEqual(auditLog.actorUserId, userId),
      targetUserId: nullWhenEqual(auditLog.targetUserId, userId),
      before: buildJsonScrub(auditLog.before),
      after: buildJsonScrub(auditLog.after),
    })
    .where(or(
      eq(auditLog.actorUserId, userId),
      eq(auditLog.targetUserId, userId),
    ))
    .returning({ id: auditLog.id })

  return {
    featureGrantsDeleted: featureGrants.length,
    featureOptInsDeleted: featureOptIns.length,
    userRolesDeleted: userRoles.length,
    featureAuditRowsAnonymised: anonymisedAuditRows.length,
  }
}
