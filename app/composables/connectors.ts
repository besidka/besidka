import { parseError } from 'evlog'
import type { ConnectorPageItem } from '#shared/types/connectors.d'
import { connectorCodeMessage } from '#shared/utils/connectors-messages'
import { CONNECTORS_LIBRARY_KEY } from '~/composables/composer-connectors'

export const CONNECTOR_VIEW_KEY_PREFIX = 'connector:'

export type ConnectorStatusTone = 'success' | 'warning' | 'error' | 'neutral'

export interface ConnectorStatusLabel {
  label: string
  tone: ConnectorStatusTone
}

/**
 * The status badge of a connector: whether it is connected, needs a review
 * or a sign-in, or failed. "Off" is the enable switch, not a status.
 */
export function getConnectorStatusLabel(
  connector: Pick<ConnectorPageItem, 'status' | 'consent'>,
): ConnectorStatusLabel {
  if (connector.status === 'needs-auth') {
    return { label: 'Needs sign-in', tone: 'warning' }
  }

  if (connector.consent.state !== 'current') {
    return { label: 'Needs consent', tone: 'warning' }
  }

  if (connector.status === 'drifted') {
    return { label: 'Tools changed', tone: 'warning' }
  }

  if (connector.status === 'error') {
    return { label: 'Error', tone: 'error' }
  }

  return { label: 'Ready', tone: 'success' }
}

export function getConnectorInitial(title: string): string {
  const letter = Array.from(title.trim())[0] ?? '?'

  return letter.toLocaleUpperCase()
}

export function reportConnectorError(
  exception: unknown,
  fallback: string,
): void {
  const parsedException = parseError(exception)

  useErrorMessage(
    parsedException.message || fallback,
    parsedException.why,
  )
}

/**
 * The account's connectors for the Connectors page, shared with the chat
 * composer's picker through the same key, so a change here shows there
 * too. Mutations refetch the list instead of merging route answers.
 */
export function useConnectorsPage() {
  const { data, status, error, refresh } = useLazyFetch('/api/v1/connectors', {
    key: CONNECTORS_LIBRARY_KEY,
    server: false,
  })

  const connectors = computed<ConnectorPageItem[]>(() => {
    return (data.value?.connectors ?? []) as ConnectorPageItem[]
  })

  const hasLoaded = computed<boolean>(() => {
    return !!data.value
  })

  return { connectors, hasLoaded, status, error, refresh }
}

export function useConnectorById(connectorId: MaybeRefOrGetter<string>) {
  const { data } = useNuxtData<{ connectors: ConnectorPageItem[] }>(
    CONNECTORS_LIBRARY_KEY,
  )

  return computed<ConnectorPageItem | null>(() => {
    const id = toValue(connectorId)

    return data.value?.connectors.find((connector) => {
      return connector.id === id
    }) ?? null
  })
}

export async function refreshConnectors(): Promise<void> {
  await refreshNuxtData(CONNECTORS_LIBRARY_KEY)
}

/**
 * Which connector the Connect dialog is open for. The detail panel and the
 * page both open it; the page renders it.
 */
export function useConnectorConnect() {
  const targetId = useState<string | null>('connectors:connect-target', () => {
    return null
  })

  function open(connectorId: string) {
    targetId.value = connectorId
  }

  function close() {
    targetId.value = null
  }

  return { targetId, open, close }
}

export interface ConnectorCallbackResult {
  kind: 'connected' | 'error'
  connectorId: string | null
  message: string
}

/**
 * Reads the OAuth callback's `?connected=<id>` or `?error=<code>`. The
 * error code is only a lookup key into fixed messages; an unknown value
 * shows a fixed fallback and is never rendered.
 */
export function readConnectorCallback(
  query: Record<string, unknown>,
): ConnectorCallbackResult | null {
  const connected = query.connected

  if (typeof connected === 'string' && /^[A-Za-z0-9]{1,64}$/.test(connected)) {
    return {
      kind: 'connected',
      connectorId: connected,
      message: 'Connector signed in',
    }
  }

  if (query.error !== undefined) {
    return {
      kind: 'error',
      connectorId: null,
      message: connectorCodeMessage(query.error),
    }
  }

  return null
}
