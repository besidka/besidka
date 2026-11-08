import {
  isMcpAdminScope,
  withoutMcpAdminScopes,
} from '#shared/utils/mcp-oauth-scopes'
import {
  getFeatureEvaluationConfig,
  isAdminUser,
  loadUserFeatureState,
} from '~~/server/utils/features/evaluate'

type AdminCheckDatabase = Parameters<typeof loadUserFeatureState>[0]

export async function isFeatureAdminUserId(
  db: AdminCheckDatabase,
  userId: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return false
  }

  const userState = await loadUserFeatureState(db, userId)

  return isAdminUser(userState, getFeatureEvaluationConfig())
}

/**
 * Returns `scopes` without the admin-only scopes unless the user is an
 * admin right now (verified email, and 2FA outside dev and CI). The user is
 * looked up only when an admin scope is present, so ordinary consents cost
 * no extra query.
 */
export async function keepMcpAdminScopesForAdmins(
  scopes: readonly string[],
  userId: number,
  db: AdminCheckDatabase,
): Promise<string[]> {
  if (!scopes.some(isMcpAdminScope)) {
    return [...scopes]
  }

  if (await isFeatureAdminUserId(db, userId)) {
    return [...scopes]
  }

  return withoutMcpAdminScopes(scopes)
}
