import { resolveProviderMetaByKeyProviderId } from '#shared/utils/provider-meta'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export type KeyEventAction = 'created' | 'updated' | 'deleted'

export function recordKeyEvent(
  keyProviderId: string,
  action: KeyEventAction,
  logger?: LoggerLike,
): void {
  const provider = resolveProviderMetaByKeyProviderId(keyProviderId)?.id
    ?? keyProviderId
  const activeLogger = logger ?? useRequestLogger(useEvent())

  activeLogger.set({
    attributes: { keys: { provider, action } },
  })
}
