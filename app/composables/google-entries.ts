import { parseError } from 'evlog'
import { LazyProfileConnectorsGoogleDetailPanel } from '#components'
import type { GoogleByoCapability } from '#shared/utils/google-byo'
import {
  GOOGLE_THIRD_PARTY_ACCESS_URL,
} from '#shared/utils/google-connections'
import {
  buildGoogleEntryPath,
} from '#shared/utils/google-connectors'
import type { GoogleEntryId } from '#shared/utils/google-connectors'
import {
  GOOGLE_BYO_DISCONNECT_SERVICES,
  GOOGLE_BYO_DRIVE_WRITE_CAPABILITIES,
  GOOGLE_BYO_SERVICE_CAPABILITIES,
  GOOGLE_ENTRY_DEFINITIONS,
  getGoogleByoRequestedCapabilities,
  resolveGoogleEntries,
} from '~/utils/google-entries'
import type { GoogleEntry } from '~/utils/google-entries'

export const GOOGLE_ENTRY_VIEW_KEY_PREFIX = 'google-entry:'

/**
 * The Google entries of the Connectors page, resolved from the connection
 * status (the same fetch key the API Keys page uses) and the feature flags.
 * Nothing is listed until the status has loaded.
 */
export function useGoogleEntries() {
  const { data, status, refresh } = useGoogleConnection()
  const driveFeature = useFeature('google.drive')
  const gmailFeature = useFeature('google.gmail')
  const calendarFeature = useFeature('google.calendar')

  const isCalendarActive = computed<boolean>(() => {
    return calendarFeature.value.active
  })

  const entries = computed<GoogleEntry[]>(() => {
    return resolveGoogleEntries({
      status: data.value ?? null,
      driveFeature: driveFeature.value,
      isGmailActive: gmailFeature.value.active,
      isCalendarActive: isCalendarActive.value,
    })
  })

  return { data, status, refresh, entries, isCalendarActive }
}

/**
 * Opens one Google entry in the side panel, from the page, a Discover card
 * or a link from another page.
 */
export function useGoogleEntryPanel() {
  const sidePanel = useSidePanel()

  function open(entryId: GoogleEntryId) {
    sidePanel.open({
      viewKey: `${GOOGLE_ENTRY_VIEW_KEY_PREFIX}${entryId}`,
      title: GOOGLE_ENTRY_DEFINITIONS[entryId].title,
      mode: 'detail',
      component: LazyProfileConnectorsGoogleDetailPanel,
      props: { entryId },
    })
  }

  return { open }
}

function buildDisconnectSubtitle(
  entry: GoogleEntry,
  dedicatedClient: boolean | undefined,
): string {
  if (entry.clientMode === 'byo') {
    return 'Google cannot remove one service alone, so this ends the one '
      + `connection that ${GOOGLE_BYO_DISCONNECT_SERVICES} share. Besidka `
      + 'removes its access at Google and deletes the stored tokens. The '
      + 'saved client stays until you delete it.'
  }

  const lines = [
    'Besidka removes its access at Google, and the Google Drive files '
    + 'copied into Besidka will be deleted. This also happens whenever '
    + 'Google access ends.',
  ]

  if (dedicatedClient === false) {
    lines.push('Google will ask for your consent again the next time you '
      + 'use Sign in with Google.')
  }

  return lines.join(' ')
}

/**
 * Connect, add access and disconnect for the Google entries, on the routes
 * the API Keys cards use. A connect returns to the Connectors page on the
 * entry's own panel. One busy flag covers every entry, because the own
 * client's three services share one grant.
 */
export function useGoogleEntryActions() {
  const { data, refresh, isCalendarActive } = useGoogleEntries()
  const isBusy = useState<boolean>('google-entry:busy', () => false)
  const announcement = useState<string>('google-entry:announcement', () => '')

  async function startAuthorization(
    request: () => Promise<{ authorizationUrl: string }>,
    failureTitle: string,
  ) {
    isBusy.value = true

    try {
      const { authorizationUrl } = await request()

      await navigateTo(authorizationUrl, { external: true })
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || failureTitle,
        parsedException.why,
      )
      isBusy.value = false
    }
  }

  async function connect(entry: GoogleEntry) {
    if (entry.clientMode === 'besidka') {
      await startAuthorization(() => {
        return $fetch('/api/v1/google/oauth/start', {
          method: 'POST',
          body: { returnTo: buildGoogleEntryPath(entry.id) },
        })
      }, 'Google Drive could not be connected')

      return
    }

    await requestOwnClientAccess(
      entry,
      GOOGLE_BYO_SERVICE_CAPABILITIES[
        entry.service === 'calendar' ? 'calendar' : 'gmail'
      ],
    )
  }

  async function requestOwnClientAccess(
    entry: GoogleEntry,
    additions: readonly GoogleByoCapability[],
  ) {
    const capabilities = getGoogleByoRequestedCapabilities(
      additions,
      data.value?.byo?.connection ?? null,
      isCalendarActive.value,
    )

    await startAuthorization(() => {
      return $fetch('/api/v1/google/byo/start', {
        method: 'POST',
        body: { capabilities, returnTo: buildGoogleEntryPath(entry.id) },
      })
    }, 'Google could not be connected')
  }

  async function addDriveSearchAccess(entry: GoogleEntry) {
    await requestOwnClientAccess(
      entry,
      GOOGLE_BYO_SERVICE_CAPABILITIES.drive,
    )
  }

  async function addDriveWriteAccess(entry: GoogleEntry) {
    await requestOwnClientAccess(
      entry,
      GOOGLE_BYO_DRIVE_WRITE_CAPABILITIES,
    )
  }

  function reportRevoke(isRevoked: boolean) {
    if (isRevoked) {
      return
    }

    useErrorMessage(
      'Google did not confirm that Besidka\'s access was removed',
      `Remove it yourself at ${GOOGLE_THIRD_PARTY_ACCESS_URL}`,
    )
  }

  async function disconnect(entry: GoogleEntry): Promise<boolean> {
    const isOwnClient = entry.clientMode === 'byo'
    const confirmation = await useConfirm({
      text: isOwnClient
        ? 'Disconnect your own Google client?'
        : 'Disconnect Google Drive?',
      subtitle: buildDisconnectSubtitle(entry, data.value?.dedicatedClient),
      alert: true,
      actions: ['Disconnect'],
      labelDecline: 'Cancel',
    })

    if (!confirmation) {
      return false
    }

    isBusy.value = true

    try {
      const result = await $fetch('/api/v1/google/connections/disconnect', {
        method: 'POST',
        ...(isOwnClient ? { body: { clientMode: 'byo' } } : {}),
      })

      await refresh()

      if (isOwnClient) {
        useSuccessMessage('Google disconnected')
        announcement.value = 'Google disconnected. Gmail, Google Calendar '
          + 'and whole-Drive search stopped.'
      } else {
        useSuccessMessage(
          'Google Drive disconnected',
          result.filesPending
            ? 'The copied Google Drive files are being deleted; this '
            + 'finishes shortly.'
            : 'The copied Google Drive files were deleted.',
        )
        announcement.value = 'Google Drive disconnected.'
      }

      reportRevoke(result.revoked)

      return true
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Google could not be disconnected',
        parsedException.why,
      )

      return false
    } finally {
      isBusy.value = false
    }
  }

  async function run(entry: GoogleEntry) {
    if (isBusy.value) {
      return
    }

    if (entry.action === 'link' && entry.linkPath) {
      await navigateTo(entry.linkPath)

      return
    }

    if (entry.action === 'disconnect') {
      await disconnect(entry)

      return
    }

    if (
      entry.action === 'connect'
      || entry.action === 'reconnect'
      || entry.action === 'add-access'
    ) {
      await connect(entry)
    }
  }

  return {
    isBusy,
    announcement,
    run,
    connect,
    disconnect,
    addDriveSearchAccess,
    addDriveWriteAccess,
  }
}
