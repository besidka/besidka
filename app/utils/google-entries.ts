import {
  GOOGLE_CALENDAR_ICON,
  GOOGLE_DRIVE_ICON,
  GOOGLE_GMAIL_ICON,
} from '#shared/utils/google-brand-icons'
import { GOOGLE_BYO_CAPABILITIES } from '#shared/utils/google-byo'
import type { GoogleByoCapability } from '#shared/utils/google-byo'
import {
  GOOGLE_KEYS_TAB_PATH,
  GOOGLE_LABS_PATH,
} from '#shared/utils/google-connectors'
import type { GoogleEntryId } from '#shared/utils/google-connectors'
import type {
  GoogleConnectionStatusResponse,
  GoogleConnectionSummary,
} from '#shared/utils/google-connections'
import type { GoogleClientMode } from '#shared/utils/google-scopes'
import type { GoogleService } from '#shared/utils/google-tool-catalog'

export type GoogleEntryState
  = | 'off-in-labs'
    | 'needs-client'
    | 'not-connected'
    | 'connected'
    | 'partial'
    | 'needs-reauth'
    | 'unavailable'

export type GoogleEntryAction
  = 'connect' | 'reconnect' | 'add-access' | 'disconnect' | 'link'

export interface GoogleEntry {
  id: GoogleEntryId
  service: GoogleService
  title: string
  icon: string
  description: string
  clientMode: GoogleClientMode
  state: GoogleEntryState
  stateLine: string
  email: string | null
  action: GoogleEntryAction | null
  actionLabel: string | null
  linkPath: string | null
  connection: GoogleConnectionSummary | null
  canDisconnect: boolean
}

export interface GoogleFeatureState {
  enabled: boolean
  active: boolean
}

export interface GoogleEntriesInput {
  status: GoogleConnectionStatusResponse | null
  driveFeature: GoogleFeatureState
  isGmailActive: boolean
  isCalendarActive: boolean
}

interface EntryDefinition {
  id: GoogleEntryId
  service: GoogleService
  title: string
  icon: string
  description: string
  connectLabel: string
}

export const GOOGLE_ENTRY_DEFINITIONS: Readonly<
  Record<GoogleEntryId, EntryDefinition>
> = {
  'google-drive': {
    id: 'google-drive',
    service: 'drive',
    title: 'Google Drive',
    icon: GOOGLE_DRIVE_ICON,
    description: 'Files you pick. Covers Docs, Sheets and Slides. With '
      + 'Besidka\'s built-in Google connection it only reads the files you '
      + 'pick (Sheets through the Sheets API) and saves a file only after '
      + 'you approve it. With your own Google client and Change files '
      + 'access it can also create files and folders when you approve, or '
      + 'without asking if you set that tool to Always allow.',
    connectLabel: 'Connect Google Drive',
  },
  'google-gmail': {
    id: 'google-gmail',
    service: 'gmail',
    title: 'Gmail',
    icon: GOOGLE_GMAIL_ICON,
    description: 'Search and read your email, and write drafts. Besidka '
      + 'never sends mail.',
    connectLabel: 'Connect Gmail',
  },
  'google-calendar': {
    id: 'google-calendar',
    service: 'calendar',
    title: 'Google Calendar',
    icon: GOOGLE_CALENDAR_ICON,
    description: 'List your events, check when you are busy and create one '
      + 'event you approve, or without asking if you set that tool to '
      + 'Always allow.',
    connectLabel: 'Connect Google Calendar',
  },
}

export const GOOGLE_BYO_DISCONNECT_SERVICES
  = 'Gmail, Google Calendar and whole-Drive search'

export const GOOGLE_BYO_SERVICE_CAPABILITIES: Readonly<
  Record<'gmail' | 'calendar' | 'drive', GoogleByoCapability[]>
> = {
  gmail: ['gmail-read', 'gmail-compose'],
  calendar: ['calendar'],
  drive: ['drive-read'],
}

export const GOOGLE_BYO_DRIVE_WRITE_CAPABILITIES: GoogleByoCapability[]
  = ['drive-write']

export type GoogleDriveWriteAccess
  = 'hidden' | 'needs-read' | 'available' | 'granted'

/**
 * Where the owner stands on "Change files in Google Drive" in the Drive
 * panel: nothing for anyone who cannot manage an own client or has none,
 * a disabled hint until Drive read access is granted on an active
 * connection, then the checkbox, then a read-only line once granted. It
 * never changes the Drive entry's own state, so a read-only owner is not
 * shown as partial.
 */
export function resolveGoogleDriveWriteAccess(
  byo: GoogleConnectionStatusResponse['byo'] | null | undefined,
): GoogleDriveWriteAccess {
  if (!byo?.canManage || !byo.hasClient) {
    return 'hidden'
  }

  const connection = byo.connection

  if (connection?.status !== 'active') {
    return 'needs-read'
  }

  if (connection.capabilities.includes('drive-write')) {
    return 'granted'
  }

  return connection.capabilities.includes('drive-read')
    ? 'available'
    : 'needs-read'
}

const STATE_LINES: Readonly<Record<GoogleEntryState, string>> = {
  'off-in-labs': 'Off in Labs',
  'needs-client': 'Needs your own Google client',
  'not-connected': 'Not connected',
  'connected': 'Connected',
  'partial': 'Connected',
  'needs-reauth': 'Needs reconnect',
  'unavailable': 'Not available for this account',
}

function buildEntry(
  definition: EntryDefinition,
  clientMode: GoogleClientMode,
  connection: GoogleConnectionSummary | null,
  overrides: Partial<GoogleEntry> & Pick<GoogleEntry, 'state'>,
): GoogleEntry {
  return {
    id: definition.id,
    service: definition.service,
    title: definition.title,
    icon: definition.icon,
    description: definition.description,
    clientMode,
    stateLine: STATE_LINES[overrides.state],
    email: null,
    action: null,
    actionLabel: null,
    linkPath: null,
    connection,
    canDisconnect: connection !== null,
    ...overrides,
  }
}

function resolveDriveEntry(input: GoogleEntriesInput): GoogleEntry | null {
  const { status, driveFeature } = input
  const definition = GOOGLE_ENTRY_DEFINITIONS['google-drive']
  const connection = status?.connection ?? null

  if (!status || (!driveFeature.enabled && !connection)) {
    return null
  }

  if (!driveFeature.enabled) {
    return buildEntry(definition, 'besidka', connection, {
      state: 'unavailable',
      email: connection?.email ?? null,
      action: 'disconnect',
      actionLabel: 'Disconnect',
    })
  }

  if (!driveFeature.active) {
    return buildEntry(definition, 'besidka', connection, {
      state: 'off-in-labs',
      action: 'link',
      actionLabel: 'Open Labs',
      linkPath: GOOGLE_LABS_PATH,
    })
  }

  if (!connection) {
    return buildEntry(definition, 'besidka', null, {
      state: 'not-connected',
      action: 'connect',
      actionLabel: definition.connectLabel,
    })
  }

  if (connection.status !== 'active') {
    return buildEntry(definition, 'besidka', connection, {
      state: 'needs-reauth',
      email: connection.email,
      action: 'reconnect',
      actionLabel: 'Reconnect',
    })
  }

  return buildEntry(definition, 'besidka', connection, {
    state: 'connected',
    stateLine: connection.email ?? 'Unknown account',
    email: connection.email,
    action: 'disconnect',
    actionLabel: 'Disconnect',
  })
}

function describeMissingGmailAccess(
  connection: GoogleConnectionSummary,
): string | null {
  const hasRead = connection.capabilities.includes('gmail-read')
  const hasCompose = connection.capabilities.includes('gmail-compose')

  if (hasRead && hasCompose) {
    return null
  }

  if (hasRead) {
    return 'Drafts access not granted'
  }

  return hasCompose ? 'Read access not granted' : 'Gmail access not granted'
}

function describeMissingCalendarAccess(
  connection: GoogleConnectionSummary,
): string | null {
  if (connection.capabilities.includes('calendar')) {
    return null
  }

  if (connection.partialCalendar === 'events') {
    return 'Free and busy access not granted'
  }

  return connection.partialCalendar === 'free-busy'
    ? 'Event access not granted'
    : 'Google Calendar access not granted'
}

function holdsAccessTo(
  entryId: GoogleEntryId,
  connection: GoogleConnectionSummary,
): boolean {
  if (entryId === 'google-gmail') {
    return connection.capabilities.includes('gmail-read')
      || connection.capabilities.includes('gmail-compose')
  }

  return connection.capabilities.includes('calendar')
    || connection.partialCalendar !== undefined
}

function resolveByoEntry(
  input: GoogleEntriesInput,
  entryId: 'google-gmail' | 'google-calendar',
): GoogleEntry | null {
  const definition = GOOGLE_ENTRY_DEFINITIONS[entryId]
  const byo = input.status?.byo ?? null
  const connection = byo?.connection ?? null
  const isFlagActive = entryId === 'google-gmail'
    ? input.isGmailActive
    : input.isCalendarActive

  if (!byo) {
    return null
  }

  if (!byo.canManage) {
    return connection && holdsAccessTo(entryId, connection)
      ? buildEntry(definition, 'byo', connection, {
        state: 'unavailable',
        email: connection.email,
        action: 'disconnect',
        actionLabel: 'Disconnect',
      })
      : null
  }

  if (!isFlagActive) {
    return buildEntry(definition, 'byo', connection, {
      state: 'off-in-labs',
      email: connection?.email ?? null,
      action: 'link',
      actionLabel: 'Open Labs',
      linkPath: GOOGLE_LABS_PATH,
    })
  }

  if (!byo.hasClient) {
    return buildEntry(definition, 'byo', connection, {
      state: 'needs-client',
      action: 'link',
      actionLabel: 'Add client',
      linkPath: GOOGLE_KEYS_TAB_PATH,
    })
  }

  if (!connection) {
    return buildEntry(definition, 'byo', null, {
      state: 'not-connected',
      action: 'connect',
      actionLabel: definition.connectLabel,
    })
  }

  if (connection.status !== 'active') {
    return buildEntry(definition, 'byo', connection, {
      state: 'needs-reauth',
      email: connection.email,
      action: 'reconnect',
      actionLabel: 'Reconnect',
    })
  }

  const missing = entryId === 'google-gmail'
    ? describeMissingGmailAccess(connection)
    : describeMissingCalendarAccess(connection)

  if (missing) {
    return buildEntry(definition, 'byo', connection, {
      state: 'partial',
      stateLine: missing,
      email: connection.email,
      action: 'add-access',
      actionLabel: 'Add access',
    })
  }

  return buildEntry(definition, 'byo', connection, {
    state: 'connected',
    stateLine: connection.email ?? 'Unknown account',
    email: connection.email,
    action: 'disconnect',
    actionLabel: 'Disconnect',
  })
}

/**
 * The Google entries the Connectors page shows, in order: Google Drive when
 * `google.drive` is available to the user (or a connection is left over),
 * then Gmail and Google Calendar only for the owner who passes the own
 * client gate (`byo.canManage`), or for a leftover own-client connection of
 * someone who no longer passes it.
 */
export function resolveGoogleEntries(
  input: GoogleEntriesInput,
): GoogleEntry[] {
  return [
    resolveDriveEntry(input),
    resolveByoEntry(input, 'google-gmail'),
    resolveByoEntry(input, 'google-calendar'),
  ].filter((entry): entry is GoogleEntry => entry !== null)
}

/**
 * The capabilities an own-client connect or "Add access" asks Google for:
 * what an active or needs-reconnect connection already holds plus the new
 * ones, so adding or reconnecting one service never drops another.
 * `calendar` is left out while Google Calendar is off in Labs, because the
 * server refuses it then.
 */
export function getGoogleByoRequestedCapabilities(
  additions: readonly GoogleByoCapability[],
  connection: GoogleConnectionSummary | null,
  isCalendarActive: boolean,
): GoogleByoCapability[] {
  const holdsCapabilities = connection?.status === 'active'
    || connection?.status === 'needs_reauth'
  const held = connection && holdsCapabilities
    ? GOOGLE_BYO_CAPABILITIES.filter((capability) => {
      return connection.capabilities.includes(capability)
    })
    : []

  return [...new Set([...held, ...additions])].filter((capability) => {
    return isCalendarActive || capability !== 'calendar'
  })
}
