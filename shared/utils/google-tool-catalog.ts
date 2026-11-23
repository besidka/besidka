import type { FeatureKey } from '#shared/utils/features/registry'
import {
  GOOGLE_CALENDAR_CREATE_EVENT_TOOL_NAME,
  GOOGLE_CALENDAR_FREE_BUSY_TOOL_NAME,
  GOOGLE_CALENDAR_LIST_EVENTS_TOOL_NAME,
} from '#shared/utils/google-calendar-tools'
import {
  GOOGLE_DRIVE_LIST_TOOL_NAME,
  GOOGLE_DRIVE_READ_FOUND_TOOL_NAME,
  GOOGLE_DRIVE_READ_TOOL_NAME,
  GOOGLE_DRIVE_SAVE_TOOL_NAME,
  GOOGLE_DRIVE_SEARCH_TOOL_NAME,
} from '#shared/utils/google-drive-tools'
import {
  GOOGLE_GMAIL_CREATE_DRAFT_TOOL_NAME,
  GOOGLE_GMAIL_READ_THREAD_TOOL_NAME,
  GOOGLE_GMAIL_SEARCH_TOOL_NAME,
  isGoogleOnceOnlyReadTool,
} from '#shared/utils/google-gmail-tools'
import type {
  GoogleCapability,
  GoogleClientMode,
} from '#shared/utils/google-scopes'
import type { GoogleToolKind } from '#shared/utils/google-tool-approvals'

export const GOOGLE_SERVICES = ['drive', 'gmail', 'calendar'] as const

export type GoogleService = typeof GOOGLE_SERVICES[number]

export interface GoogleToolCatalogEntry {
  name: string
  service: GoogleService
  kind: GoogleToolKind
  title: string
  client: GoogleClientMode
  neededCapability: GoogleCapability
  flag: FeatureKey
}

export const GOOGLE_TOOL_APPROVAL_LABELS = {
  needsApproval: 'Needs approval',
  asksEveryTime: 'Asks every time',
} as const

export const GOOGLE_TOOL_CATALOG: readonly GoogleToolCatalogEntry[] = [
  {
    name: GOOGLE_DRIVE_LIST_TOOL_NAME,
    service: 'drive',
    kind: 'read',
    title: 'List the files you picked',
    client: 'besidka',
    neededCapability: 'drive-picked',
    flag: 'google.drive',
  },
  {
    name: GOOGLE_DRIVE_READ_TOOL_NAME,
    service: 'drive',
    kind: 'read',
    title: 'Read a file you picked',
    client: 'besidka',
    neededCapability: 'drive-picked',
    flag: 'google.drive',
  },
  {
    name: GOOGLE_DRIVE_SAVE_TOOL_NAME,
    service: 'drive',
    kind: 'write',
    title: 'Save a Besidka file to Google Drive',
    client: 'besidka',
    neededCapability: 'drive-picked',
    flag: 'google.drive',
  },
  {
    name: GOOGLE_DRIVE_SEARCH_TOOL_NAME,
    service: 'drive',
    kind: 'read',
    title: 'Search your whole Google Drive',
    client: 'byo',
    neededCapability: 'drive-read',
    flag: 'google.byo',
  },
  {
    name: GOOGLE_DRIVE_READ_FOUND_TOOL_NAME,
    service: 'drive',
    kind: 'read',
    title: 'Read a file a search found',
    client: 'byo',
    neededCapability: 'drive-read',
    flag: 'google.byo',
  },
  {
    name: GOOGLE_GMAIL_SEARCH_TOOL_NAME,
    service: 'gmail',
    kind: 'read',
    title: 'Search your Gmail',
    client: 'byo',
    neededCapability: 'gmail-read',
    flag: 'google.gmail',
  },
  {
    name: GOOGLE_GMAIL_READ_THREAD_TOOL_NAME,
    service: 'gmail',
    kind: 'read',
    title: 'Read an email thread',
    client: 'byo',
    neededCapability: 'gmail-read',
    flag: 'google.gmail',
  },
  {
    name: GOOGLE_GMAIL_CREATE_DRAFT_TOOL_NAME,
    service: 'gmail',
    kind: 'write',
    title: 'Create a Gmail draft (never sends)',
    client: 'byo',
    neededCapability: 'gmail-compose',
    flag: 'google.gmail',
  },
  {
    name: GOOGLE_CALENDAR_LIST_EVENTS_TOOL_NAME,
    service: 'calendar',
    kind: 'read',
    title: 'List events on your Google Calendar',
    client: 'byo',
    neededCapability: 'calendar',
    flag: 'google.calendar',
  },
  {
    name: GOOGLE_CALENDAR_FREE_BUSY_TOOL_NAME,
    service: 'calendar',
    kind: 'read',
    title: 'Check when you are busy',
    client: 'byo',
    neededCapability: 'calendar',
    flag: 'google.calendar',
  },
  {
    name: GOOGLE_CALENDAR_CREATE_EVENT_TOOL_NAME,
    service: 'calendar',
    kind: 'write',
    title: 'Create one event on your Google Calendar',
    client: 'byo',
    neededCapability: 'calendar',
    flag: 'google.calendar',
  },
]

export function getGoogleServiceTools(
  service: GoogleService,
): GoogleToolCatalogEntry[] {
  return GOOGLE_TOOL_CATALOG.filter((tool) => {
    return tool.service === service
  })
}

export function getGoogleToolApprovalLabel(
  tool: Pick<GoogleToolCatalogEntry, 'name' | 'kind'>,
): string {
  return tool.kind === 'write' || isGoogleOnceOnlyReadTool(tool.name)
    ? GOOGLE_TOOL_APPROVAL_LABELS.asksEveryTime
    : GOOGLE_TOOL_APPROVAL_LABELS.needsApproval
}

export const GOOGLE_TOOL_ALWAYS_ALLOW_HINTS = {
  chatGrant: 'Google reads ask. Allow one for a chat from its approval.',
  asksEveryTime: 'Asks every time.',
} as const

/**
 * Why Always allow is off for a Google tool: a read can be allowed for one
 * chat from its approval card, while a write and a once-only read ask every
 * time.
 */
export function getGoogleToolAlwaysAllowHint(
  tool: Pick<GoogleToolCatalogEntry, 'name' | 'kind'>,
): string {
  return getGoogleToolApprovalLabel(tool)
    === GOOGLE_TOOL_APPROVAL_LABELS.asksEveryTime
    ? GOOGLE_TOOL_ALWAYS_ALLOW_HINTS.asksEveryTime
    : GOOGLE_TOOL_ALWAYS_ALLOW_HINTS.chatGrant
}

export const GOOGLE_TOOL_PERMISSION_MODES = ['blocked', 'ask'] as const

export type GoogleToolPermissionMode
  = typeof GOOGLE_TOOL_PERMISSION_MODES[number]

export const GOOGLE_TOOL_DEFAULT_MODE: GoogleToolPermissionMode = 'ask'

export const GOOGLE_TOOL_PERMISSION_WRITES_PER_MINUTE = 60

export const GOOGLE_TOOL_MODE_LABELS: Readonly<
  Record<GoogleToolPermissionMode, string>
> = {
  blocked: 'Blocked',
  ask: 'Needs approval',
}

export function isGoogleToolPermissionMode(
  value: unknown,
): value is GoogleToolPermissionMode {
  return GOOGLE_TOOL_PERMISSION_MODES.some((mode) => {
    return mode === value
  })
}

export function findGoogleCatalogTool(
  toolName: string,
): GoogleToolCatalogEntry | null {
  return GOOGLE_TOOL_CATALOG.find((tool) => {
    return tool.name === toolName
  }) ?? null
}

/**
 * The mode a stored value means for a Google tool. Only "ask" and "blocked"
 * exist for Google tools: a stored "allow" or any unknown value reads as
 * "blocked", so an unreadable setting never lets a tool run.
 */
export function readGoogleToolPermissionMode(
  stored: string | undefined,
): GoogleToolPermissionMode {
  if (stored === undefined) {
    return GOOGLE_TOOL_DEFAULT_MODE
  }

  return stored === 'ask' ? 'ask' : 'blocked'
}
