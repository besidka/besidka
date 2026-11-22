import type { UIMessage } from 'ai'
import { isGoogleToolName } from '#shared/utils/google-tool-approvals'
import type {
  GoogleStepData,
  GoogleStepReference,
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
    title: typeof record.title === 'string' ? record.title : '',
    link: isHttpsLink(record.link) ? record.link : '',
    date: typeof record.date === 'string' ? record.date : '',
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
