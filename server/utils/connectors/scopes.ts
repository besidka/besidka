import { CONNECTOR_SCOPE_MAX_LENGTH } from '#shared/utils/connectors-policy'
import type { ConnectorLastError } from '~~/server/db/schemas/connectors'
import { CONNECTOR_ERRORS } from '~~/server/utils/connectors/errors'

export interface ScopeComparison {
  grantedScope: string | null
  degraded: boolean
}

function scopeSet(scope: string): Set<string> {
  return new Set(scope.split(/\s+/).filter(Boolean))
}

/**
 * Compares the scope the token response granted with the one requested. An
 * omitted `scope` means the requested scope was granted (RFC 6749 section
 * 5.1). A grant that lacks any requested scope is degraded; extra scopes are
 * not. The stored scope is the granted one, cut to the column cap.
 */
export function compareGrantedScope(
  requestedScope: string | null,
  grantedScope: string | null,
): ScopeComparison {
  if (grantedScope === null) {
    return { grantedScope: requestedScope, degraded: false }
  }

  const granted = scopeSet(grantedScope)
  const normalizedGranted = [...granted].join(' ')
    .slice(0, CONNECTOR_SCOPE_MAX_LENGTH)

  if (!requestedScope) {
    return { grantedScope: normalizedGranted || null, degraded: false }
  }

  const degraded = [...scopeSet(requestedScope)].some((scope) => {
    return !granted.has(scope)
  })

  return { grantedScope: normalizedGranted || null, degraded }
}

/**
 * The `lastError` a connector keeps after a narrower grant: fixed text, no
 * scope names from the server, which C-7 shows on the card.
 */
export function degradedScopeNote(): ConnectorLastError {
  const text = CONNECTOR_ERRORS.CONNECTOR_SCOPE_DEGRADED

  return {
    code: 'CONNECTOR_SCOPE_DEGRADED',
    message: text.message,
    degraded: text.fix,
  }
}
