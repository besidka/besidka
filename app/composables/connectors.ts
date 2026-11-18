import { parseError } from 'evlog'
import type { ConnectorPageItem } from '#shared/types/connectors.d'
import { isConnectorNeverConnected } from '#shared/utils/connectors-connected'
import { connectorCodeMessage } from '#shared/utils/connectors-messages'
import { CONNECTORS_LIBRARY_KEY } from '~/composables/composer-connectors'

export const CONNECTOR_VIEW_KEY_PREFIX = 'connector:'

export type ConnectorStatusTone = 'success' | 'warning' | 'error' | 'neutral'

export interface ConnectorStatusLabel {
  label: string
  tone: ConnectorStatusTone
}

/**
 * Whether a connector was ever connected: a row that never was (a leftover
 * of the old add-then-connect flow, or one an app added over MCP) is shown
 * as not connected and never counts as added.
 */
export function isConnectorConnected(
  connector: Pick<ConnectorPageItem, 'status' | 'consent' | 'lastConnectedAt'>,
): boolean {
  return !isConnectorNeverConnected({
    status: connector.status,
    lastConnectedAt: connector.lastConnectedAt,
    consentedAt: connector.consent.givenAt,
  })
}

/**
 * The status badge of a connector: whether it is connected, needs a review
 * or a sign-in, or failed. "Off" is the enable switch, not a status.
 */
export function getConnectorStatusLabel(
  connector: Pick<ConnectorPageItem, 'status' | 'consent' | 'lastConnectedAt'>,
): ConnectorStatusLabel {
  if (!isConnectorConnected(connector)) {
    return { label: 'Not connected', tone: 'warning' }
  }

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

/**
 * Whether the icon route can answer for this connector (it 404s otherwise):
 * the same rule as `GET /api/v1/connectors/[id]/icon`, which serves an icon
 * for every connector except one whose consent was withdrawn.
 */
export function hasConnectorIcon(
  connector: Pick<ConnectorPageItem, 'consent'>,
): boolean {
  return connector.consent.state !== 'withdrawn'
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
 * What the user picked to add: a preset, a directory entry or an address.
 * Nothing is stored for it until the connect succeeds.
 */
export interface ConnectorDraft {
  url?: string
  title?: string
  presetId?: string
  registryId?: string
}

/**
 * Which connector the Connect dialog is open for: one that exists (`open`,
 * to connect it again or finish one an app added) or a draft that does not
 * exist yet (`openDraft`, from a preset, a directory entry or an address).
 * Closing the dialog changes nothing in either case. The detail panel and
 * the page both open it; the page renders it.
 */
export function useConnectorConnect() {
  const targetId = useState<string | null>('connectors:connect-target', () => {
    return null
  })
  const draft = useState<ConnectorDraft | null>('connectors:connect-draft', () => {
    return null
  })

  function open(connectorId: string) {
    draft.value = null
    targetId.value = connectorId
  }

  function openDraft(next: ConnectorDraft) {
    targetId.value = null
    draft.value = next
  }

  function close() {
    targetId.value = null
    draft.value = null
  }

  return { targetId, draft, open, openDraft, close }
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
