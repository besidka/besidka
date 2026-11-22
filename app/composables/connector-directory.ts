import {
  LazyProfileConnectorsDetailPanel,
  LazyProfileConnectorsDirectoryDetailPanel,
} from '#components'
import type {
  ConnectorDirectoryAuthKind,
  ConnectorDirectoryItem,
  ConnectorPageItem,
} from '#shared/types/connectors.d'
import { DIRECTORY_PRESET_ID_PREFIX } from '#shared/utils/connectors-directory'

export const CONNECTOR_DIRECTORY_VIEW_KEY_PREFIX = 'connector-directory:'

const AUTH_KIND_LABELS: Record<ConnectorDirectoryAuthKind, string> = {
  oauth: 'Sign in with your account',
  header: 'API key or token',
  none: 'No sign-in needed',
  unknown: 'Checked when you connect',
}

export function getDirectoryAuthLabel(kind: ConnectorDirectoryAuthKind) {
  return AUTH_KIND_LABELS[kind]
}

export function getDirectoryCardAuthLabel(
  item: Pick<ConnectorDirectoryItem, 'authHint'>,
): string {
  return item.authHint === 'header' ? 'API key or token' : 'Sign in or token'
}

export function isDirectoryPresetItem(
  item: Pick<ConnectorDirectoryItem, 'id'>,
): boolean {
  return item.id.startsWith(DIRECTORY_PRESET_ID_PREFIX)
}

export const FEATURED_CONNECTOR_TIP = 'Picked by Besidka as a well-known '
  + 'service. Not a security review.'

/**
 * Opens one of the user's connectors in the side panel, from the page or
 * from a directory entry that is already added.
 */
export function useConnectorDetailPanel() {
  const sidePanel = useSidePanel()

  function open(connector: Pick<ConnectorPageItem, 'id' | 'title'>) {
    sidePanel.open({
      viewKey: `${CONNECTOR_VIEW_KEY_PREFIX}${connector.id}`,
      title: connector.title,
      mode: 'detail',
      component: LazyProfileConnectorsDetailPanel,
      props: { connectorId: connector.id },
    })
  }

  return { open }
}

/**
 * The directory actions shared by the Discover cards and the entry detail
 * panel: open an entry's details, start adding it and open the connector
 * that is already added. Adding opens the Connect dialog with a draft (a
 * preset by its id, a registry entry by its directory id; the server reads
 * the address itself): nothing is stored until the connect succeeds, so
 * closing the dialog leaves nothing behind. An entry whose address matches
 * a row that never connected finishes that row instead.
 */
export function useConnectorDirectoryActions() {
  const sidePanel = useSidePanel()
  const connect = useConnectorConnect()
  const detailPanel = useConnectorDetailPanel()

  function openEntry(item: ConnectorDirectoryItem) {
    sidePanel.open({
      viewKey: `${CONNECTOR_DIRECTORY_VIEW_KEY_PREFIX}${item.id}`,
      title: item.title,
      mode: 'detail',
      component: LazyProfileConnectorsDirectoryDetailPanel,
      props: { entryId: item.id, initialItem: item },
    })
  }

  function add(item: ConnectorDirectoryItem) {
    if (item.addedConnectorId) {
      connect.open(item.addedConnectorId)

      return
    }

    connect.openDraft(
      item.presetId ? { presetId: item.presetId } : { registryId: item.id },
    )
  }

  function openAdded(connector: Pick<ConnectorPageItem, 'id' | 'title'>) {
    detailPanel.open(connector)
  }

  return { openEntry, add, openAdded }
}
