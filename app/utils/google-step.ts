import type { UIMessage } from 'ai'
import {
  GOOGLE_CALENDAR_EVENT_REFERENCE_KIND,
  GOOGLE_CALENDAR_FREE_BUSY_REFERENCE_KIND,
  describeCalendarEventDay,
  describeCalendarFreeBusyDay,
} from '#shared/utils/google-calendar-tools'
import {
  GOOGLE_DRIVE_FOLDER_REFERENCE_KIND,
  GOOGLE_DRIVE_ROOT_REFERENCE_KIND,
} from '#shared/utils/google-drive-tools'
import { GOOGLE_DRIVE_ROOT_TITLE } from '#shared/utils/google-drive-write'
import {
  GOOGLE_GMAIL_DRAFT_REFERENCE_KIND,
  GOOGLE_GMAIL_THREAD_REFERENCE_KIND,
} from '#shared/utils/google-gmail-tools'
import { isGoogleToolName } from '#shared/utils/google-tool-approvals'
import type {
  GoogleStepData,
  GoogleStepReference,
  GoogleStepReferenceLabel,
  GoogleStepState,
} from '~/types/google-step.d'

const PENDING_STATES = new Set<string>(['input-streaming', 'input-available'])
const FAILED_STATES = new Set<string>(['output-error', 'output-denied'])
const REFERENCES_SHOWN_MAX = 20

interface GoogleToolLikePart {
  type: string
  toolName?: string
  state?: string
  output?: unknown
  preliminary?: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function isHttpsLink(value: unknown): value is string {
  return typeof value === 'string'
    && URL.canParse(value)
    && new URL(value).protocol === 'https:'
}

function readReference(value: unknown): GoogleStepReference | null {
  const record = asRecord(value)

  if (!record || typeof record.id !== 'string') {
    return null
  }

  return {
    id: record.id,
    kind: typeof record.kind === 'string' ? record.kind : '',
    title: typeof record.title === 'string' ? record.title : '',
    link: isHttpsLink(record.link) ? record.link : '',
    date: typeof record.date === 'string' ? record.date : '',
  }
}

function readDay(date: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : ''
}

/**
 * The line a reference shows after a reload. An email reference holds only
 * a thread id, a link and Gmail's own timestamp (never a sender, a subject
 * or a snippet), so it reads "Email thread" with its date; a draft reads
 * "Draft"; a Calendar reference holds only an event id, a link and the
 * start day (never a title or a guest), so it reads "Calendar event on
 * <day>"; a Drive reference shows the file name.
 */
export function describeGoogleStepReference(
  reference: GoogleStepReference,
): GoogleStepReferenceLabel {
  if (reference.kind === GOOGLE_GMAIL_THREAD_REFERENCE_KIND) {
    const day = readDay(reference.date)

    return {
      text: day ? `Email thread from ${day}` : 'Email thread',
      linkText: 'Open in Gmail',
      linkLabel: day
        ? `Open the email thread from ${day} in Gmail`
        : 'Open the email thread in Gmail',
    }
  }

  if (reference.kind === GOOGLE_GMAIL_DRAFT_REFERENCE_KIND) {
    return {
      text: 'Draft saved in Gmail',
      linkText: 'Open drafts in Gmail',
      linkLabel: 'Open your drafts in Gmail',
    }
  }

  if (reference.kind === GOOGLE_CALENDAR_EVENT_REFERENCE_KIND) {
    const day = readDay(reference.date)

    return {
      text: describeCalendarEventDay(reference.date),
      linkText: 'Open in Google Calendar',
      linkLabel: day
        ? `Open the event on ${day} in Google Calendar`
        : 'Open the event in Google Calendar',
    }
  }

  if (reference.kind === GOOGLE_CALENDAR_FREE_BUSY_REFERENCE_KIND) {
    const day = readDay(reference.date)

    return {
      text: describeCalendarFreeBusyDay(reference.date),
      linkText: 'Open in Google Calendar',
      linkLabel: day
        ? `Open ${day} in Google Calendar`
        : 'Open Google Calendar',
    }
  }

  if (reference.kind === GOOGLE_DRIVE_ROOT_REFERENCE_KIND) {
    return {
      text: GOOGLE_DRIVE_ROOT_TITLE,
      linkText: 'Open in Google Drive',
      linkLabel: 'Open My Drive in Google Drive',
    }
  }

  if (reference.kind === GOOGLE_DRIVE_FOLDER_REFERENCE_KIND) {
    return {
      text: reference.title || 'Google Drive folder',
      linkText: 'Open in Google Drive',
      linkLabel: `Open ${reference.title || 'folder'} in Google Drive`,
    }
  }

  return {
    text: reference.title || 'Google Drive file',
    linkText: 'Open in Google Drive',
    linkLabel: `Open ${reference.title || 'file'} in Google Drive`,
  }
}

function resolveState(part: GoogleToolLikePart): GoogleStepState {
  if (FAILED_STATES.has(part.state ?? '')) {
    return 'failed'
  }

  if (
    PENDING_STATES.has(part.state ?? '')
    || (part.state === 'output-available' && part.preliminary === true)
  ) {
    return 'working'
  }

  return 'done'
}

function toolNameOf(part: GoogleToolLikePart): string {
  if (part.type === 'dynamic-tool') {
    return part.toolName ?? ''
  }

  return part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : ''
}

/**
 * What a reasoning step shows for a Google tool call, read from the stored
 * part: the references of the result (the only thing kept after the reply
 * was saved, never a body) as file names with a link that opens the file in
 * Google Drive. A call with no references, or one that failed, shows the
 * step title alone.
 */
export function getGoogleStepData(
  part: UIMessage['parts'][number],
): GoogleStepData | null {
  const toolPart = part as GoogleToolLikePart
  const toolName = toolNameOf(toolPart)

  if (!isGoogleToolName(toolName)) {
    return null
  }

  const state = resolveState(toolPart)
  const output = state === 'done' ? asRecord(toolPart.output) : null
  const references = Array.isArray(output?.references)
    ? output.references
      .slice(0, REFERENCES_SHOWN_MAX)
      .map(readReference)
      .filter((reference): reference is GoogleStepReference => {
        return reference !== null
      })
    : []

  return { toolName, state, references }
}
