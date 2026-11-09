import type { FeatureEvaluationConfig } from '~~/server/utils/features/provider'
import { listAdminUserRoles } from '~~/server/utils/features/admin-queries'

/**
 * Every admin who should hear about operational events: env admins (the
 * `adminEmails` list, verified email) and holders of the `admin` role. Keyed
 * by user id, so an account that is both is listed once.
 */
export async function listAdminRecipients(
  db: Parameters<typeof listAdminUserRoles>[0],
  config: FeatureEvaluationConfig,
): Promise<Map<number, string>> {
  const { roles, envAdmins } = await listAdminUserRoles(db, config)
  const recipients = new Map<number, string>()

  for (const admin of envAdmins) {
    recipients.set(admin.id, admin.email)
  }

  for (const role of roles) {
    if (role.role === 'admin' && role.email) {
      recipients.set(role.userId, role.email)
    }
  }

  return recipients
}
