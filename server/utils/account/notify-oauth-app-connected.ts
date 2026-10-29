import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { sendOAuthAppConnectedEmail } from '~~/server/utils/account/security-emails'

const CONNECTED_APPS_PATH = '/profile/connected-apps'
const DEFAULT_SITE_URL = 'https://besidka.com'

export async function notifyOAuthAppConnected({
  user,
  clientId,
  scopes,
  logger,
}: {
  user: { email: string }
  clientId: string | null
  scopes: string[]
  logger?: LoggerLike
}): Promise<void> {
  if (!clientId) {
    return
  }

  const [client] = await useDb()
    .select({ name: schema.oauthClients.name })
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.clientId, clientId))
    .limit(1)
  const siteUrl = useRuntimeConfig().public.baseUrl || DEFAULT_SITE_URL

  await sendOAuthAppConnectedEmail({
    user,
    appName: client?.name,
    scopes,
    connectedAt: new Date(),
    connectedAppsUrl: `${siteUrl}${CONNECTED_APPS_PATH}`,
    logger,
  })
}
