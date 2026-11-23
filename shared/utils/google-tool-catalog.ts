import type { FeatureKey } from '#shared/utils/features/registry'
import {
  GOOGLE_CALENDAR_CREATE_EVENT_TOOL_NAME,
  GOOGLE_CALENDAR_FREE_BUSY_TOOL_NAME,
  GOOGLE_CALENDAR_LIST_EVENTS_TOOL_NAME,
} from '#shared/utils/google-calendar-tools'
import {
  GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME,
  GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME,
  GOOGLE_DRIVE_LIST_TOOL_NAME,
  GOOGLE_DRIVE_MOVE_TOOL_NAME,
  GOOGLE_DRIVE_RENAME_TOOL_NAME,
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
    name: GOOGLE_DRIVE_LIST_FOLDER_TOOL_NAME,
    service: 'drive',
    kind: 'read',
    title: 'List folders in your Google Drive',
    client: 'byo',
    neededCapability: 'drive-write',
    flag: 'google.byo',
  },
  {
    name: GOOGLE_DRIVE_CREATE_FOLDER_TOOL_NAME,
    service: 'drive',
    kind: 'write',
    title: 'Create a folder in your Google Drive',
    client: 'byo',
    neededCapability: 'drive-write',
    flag: 'google.byo',
  },
  {
    name: GOOGLE_DRIVE_RENAME_TOOL_NAME,
    service: 'drive',
    kind: 'write',
    title: 'Rename a file or folder you own',
    client: 'byo',
    neededCapability: 'drive-write',
    flag: 'google.byo',
  },
  {
    name: GOOGLE_DRIVE_MOVE_TOOL_NAME,
    service: 'drive',
    kind: 'write',
    title: 'Move a file or folder you own',
    client: 'byo',
    neededCapability: 'drive-write',
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
  appReview: 'Needs approval: this connection goes through Google\'s app '
    + 'review.',
} as const

export const GOOGLE_TOOL_PERMISSION_MODES = ['blocked', 'ask', 'allow'] as const

export type GoogleToolPermissionMode
  = typeof GOOGLE_TOOL_PERMISSION_MODES[number]

export const GOOGLE_TOOL_DEFAULT_MODE: GoogleToolPermissionMode = 'ask'

export const GOOGLE_TOOL_PERMISSION_WRITES_PER_MINUTE = 60

export const GOOGLE_ALWAYS_ALLOW_READS_PER_MESSAGE = 5

export const GOOGLE_ALWAYS_ALLOW_WRITES_PER_MESSAGE = 10

export const GOOGLE_ALWAYS_ALLOW_WRITES_PER_HOUR = 30

export const GOOGLE_TOOL_MODE_LABELS: Readonly<
  Record<GoogleToolPermissionMode, string>
> = {
  blocked: 'Blocked',
  ask: 'Needs approval',
  allow: 'Always allow',
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
 * Whether a Google tool may be set to Always allow: only a tool that exists
 * on the owner-only own (bring-your-own) client. A tool that is also
 * reachable through Besidka's own Google client (the Picker and `drive.file`
 * family) keeps asking, because that connection goes through Google's app
 * review. Takes a catalog entry or a tool name; an unknown name is never
 * allowable.
 */
export function isGoogleToolAlwaysAllowable(
  tool: string | Pick<GoogleToolCatalogEntry, 'client'>,
): boolean {
  const entry = typeof tool === 'string' ? findGoogleCatalogTool(tool) : tool

  return entry !== null && entry.client === 'byo'
}

/**
 * The modes the user may pick for a Google tool: Always allow only for a
 * tool `isGoogleToolAlwaysAllowable` accepts.
 */
export function getGoogleToolModes(
  tool: Pick<GoogleToolCatalogEntry, 'client'>,
): readonly GoogleToolPermissionMode[] {
  return isGoogleToolAlwaysAllowable(tool)
    ? GOOGLE_TOOL_PERMISSION_MODES
    : GOOGLE_TOOL_PERMISSION_MODES.filter(mode => mode !== 'allow')
}

/**
 * Why Always allow is off for a Google tool the user cannot always allow.
 */
export function getGoogleToolAlwaysAllowHint(): string {
  return GOOGLE_TOOL_ALWAYS_ALLOW_HINTS.appReview
}

const GOOGLE_ALWAYS_ALLOW_READ_WARNING = 'Always allow lets the model read '
  + 'this without asking, including text written by other people.'

const GOOGLE_ALWAYS_ALLOW_ONCE_ONLY_READ_WARNINGS: Readonly<
  Record<string, string>
> = {
  [GOOGLE_GMAIL_READ_THREAD_TOOL_NAME]: 'Always allow lets the model open '
    + 'whole email threads without asking, including everything other people '
    + 'wrote in them.',
  [GOOGLE_DRIVE_READ_FOUND_TOOL_NAME]: 'Always allow lets the model open '
    + 'the files a search found without asking, including everything other '
    + 'people wrote in them.',
}

const GOOGLE_ALWAYS_ALLOW_WRITE_WARNINGS: Readonly<
  Record<GoogleService, string>
> = {
  gmail: 'Always allow lets the model create drafts without asking. '
    + 'Google\'s permission for drafts also allows sending mail; Besidka has '
    + 'no code that sends mail.',
  calendar: 'Always allow lets the model create events without asking.',
  drive: 'Always allow lets the model create, rename and move Drive items '
    + 'without asking. Google\'s permission for Drive also allows deleting '
    + 'and sharing; Besidka has no code that deletes or shares.',
}

/**
 * The warning shown under a Google tool that can be set to Always allow, or
 * null for a tool that cannot. A once-only read (a whole email thread, a
 * found Drive file) names what it hands the model; a plain read says the
 * result can hold text written by other people; a write names what it
 * creates or changes.
 */
export function getGoogleToolAlwaysAllowWarning(
  tool: Pick<GoogleToolCatalogEntry, 'name' | 'kind' | 'service' | 'client'>,
): string | null {
  if (!isGoogleToolAlwaysAllowable(tool)) {
    return null
  }

  if (tool.kind === 'write') {
    return GOOGLE_ALWAYS_ALLOW_WRITE_WARNINGS[tool.service]
  }

  return GOOGLE_ALWAYS_ALLOW_ONCE_ONLY_READ_WARNINGS[tool.name]
    ?? GOOGLE_ALWAYS_ALLOW_READ_WARNING
}

/**
 * The mode a stored value means for a Google tool. No row means "ask". A
 * stored "allow" counts only for a tool that can be always allowed; for any
 * other tool (a restored or hand-written row) it reads as "ask", never as
 * "allow" and never as "blocked". Any other value reads as "blocked", so an
 * unreadable setting never lets a tool run.
 */
export function readGoogleToolPermissionMode(
  toolName: string,
  stored: string | undefined,
): GoogleToolPermissionMode {
  if (stored === undefined || stored === 'ask') {
    return GOOGLE_TOOL_DEFAULT_MODE
  }

  if (stored === 'allow') {
    return isGoogleToolAlwaysAllowable(toolName) ? 'allow' : 'ask'
  }

  return 'blocked'
}
