import {
  CONNECTOR_CONSENT_ERROR_CODE,
  CONNECTOR_CONSENT_VERSION,
} from '#shared/utils/connectors-policy'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import type { ConnectorRecord } from '~~/server/utils/connectors/store'

type ConsentFields = Pick<
  ConnectorRecord,
  | 'id'
  | 'origin'
  | 'consentOrigin'
  | 'consentIssuer'
  | 'consentVersion'
  | 'consentedAt'
  | 'consentWithdrawnAt'
>

export function issuerHostOf(issuer: string): string {
  return new URL(issuer).host
}

/**
 * Whether the per-connector consent (docs/connectors.md section 2, item 5)
 * covers a request: given for this origin, for the current text version,
 * not withdrawn since, and, when an issuer host is passed, for that issuer.
 * A changed origin, issuer or version asks again.
 */
export function isConnectorConsentCurrent(
  connector: ConsentFields,
  issuerHost?: string | null,
): boolean {
  if (
    !connector.consentedAt
    || connector.consentOrigin !== connector.origin
    || connector.consentVersion !== CONNECTOR_CONSENT_VERSION
  ) {
    return false
  }

  if (
    connector.consentWithdrawnAt
    && connector.consentWithdrawnAt.getTime() >= connector.consentedAt.getTime()
  ) {
    return false
  }

  if (issuerHost !== undefined && issuerHost !== connector.consentIssuer) {
    return false
  }

  return true
}

export function assertConnectorConsent(
  connector: ConsentFields,
  issuerHost?: string | null,
): void {
  if (isConnectorConsentCurrent(connector, issuerHost)) {
    return
  }

  throw createConnectorError(CONNECTOR_CONSENT_ERROR_CODE, {
    connectorId: connector.id,
  })
}
