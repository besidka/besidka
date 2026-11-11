import {
  ERROR_CODES,
  INTERACTIVE_REQUEST_TIMEOUT_MS,
  MAX_CLIPBOARD_TEXT_LENGTH,
  MAX_DIAGRAM_SOURCE_LENGTH,
  METHODS,
  RpcError,
} from '@besidka/artifacts-protocol'
import type {
  ClipboardFailureReason,
  DiagramExportAction,
  RuntimeConnection,
} from '@besidka/artifacts-protocol'

export type HostActionOutcome
  = | { ok: true }
    | { ok: false, message: string }

let connection: RuntimeConnection | null = null

const NOT_AVAILABLE_MESSAGE = 'Not available here.'

const TOO_LARGE_MESSAGE = 'Too large to send.'

const NEEDS_CLICK_MESSAGE = 'Needs a click in the artifact.'

const EXPORT_NOT_DONE_MESSAGE = 'The diagram was not exported.'

const CLIPBOARD_FAILURE_MESSAGES: Record<ClipboardFailureReason, string> = {
  'gesture-required': 'The browser blocked copying from the artifact.',
  'denied': 'The browser denied access to the clipboard.',
  'unavailable': 'Copying is not available here.',
}

const ERROR_MESSAGES: Record<number, string> = {
  [ERROR_CODES.methodNotFound]: NOT_AVAILABLE_MESSAGE,
  [ERROR_CODES.rateLimited]: 'Too many requests. Try again in a moment.',
  [ERROR_CODES.notAllowed]: NEEDS_CLICK_MESSAGE,
  [ERROR_CODES.invalidParams]: TOO_LARGE_MESSAGE,
  [ERROR_CODES.requestTimeout]: 'The request timed out.',
}

export function setHostActionConnection(next: RuntimeConnection) {
  connection = next
}

/**
 * The frame's own claim that a real click started this request. It is a
 * trust signal only: artifact code shares this realm, so the host checks
 * its own `navigator.userActivation` as well before acting.
 */
export function hasUserGesture(event: Event): boolean {
  if (!event.isTrusted) {
    return false
  }

  return navigator.userActivation?.isActive ?? true
}

function describeFailure(exception: unknown): HostActionOutcome {
  if (exception instanceof RpcError) {
    return {
      ok: false,
      message: ERROR_MESSAGES[exception.code] ?? 'The request failed.',
    }
  }

  return { ok: false, message: 'The request failed.' }
}

export async function copyThroughHost(
  text: string,
  event: Event,
): Promise<HostActionOutcome> {
  if (!event.isTrusted) {
    return {
      ok: false,
      message: CLIPBOARD_FAILURE_MESSAGES['gesture-required'],
    }
  }

  if (!connection) {
    return { ok: false, message: CLIPBOARD_FAILURE_MESSAGES.unavailable }
  }

  if (text.length > MAX_CLIPBOARD_TEXT_LENGTH) {
    return { ok: false, message: TOO_LARGE_MESSAGE }
  }

  try {
    const result = await connection.request(
      METHODS.clipboardWrite,
      { text, mimeType: 'text/plain', userActivation: hasUserGesture(event) },
      { timeoutMs: INTERACTIVE_REQUEST_TIMEOUT_MS },
    )

    if (result.copied) {
      return { ok: true }
    }

    return { ok: false, message: CLIPBOARD_FAILURE_MESSAGES[result.reason] }
  } catch (exception) {
    return describeFailure(exception)
  }
}

/**
 * Asks the parent to download or copy a Mermaid diagram the way the chat
 * does: the parent renders the source with its own Mermaid, builds the SVG,
 * PNG or draw.io file and saves it or writes the clipboard, because the
 * sandboxed frame can do neither. Without a gesture the parent asks the
 * viewer to confirm with a click of its own.
 */
export async function exportDiagramThroughHost(
  source: string,
  action: DiagramExportAction,
  event: Event,
): Promise<HostActionOutcome> {
  if (!event.isTrusted) {
    return { ok: false, message: NEEDS_CLICK_MESSAGE }
  }

  if (!connection) {
    return { ok: false, message: NOT_AVAILABLE_MESSAGE }
  }

  if (source.length > MAX_DIAGRAM_SOURCE_LENGTH) {
    return { ok: false, message: TOO_LARGE_MESSAGE }
  }

  try {
    const result = await connection.request(
      METHODS.diagramExport,
      { source, action, userActivation: hasUserGesture(event) },
      { timeoutMs: INTERACTIVE_REQUEST_TIMEOUT_MS },
    )

    return result.completed
      ? { ok: true }
      : { ok: false, message: EXPORT_NOT_DONE_MESSAGE }
  } catch (exception) {
    return describeFailure(exception)
  }
}

export async function openDiagramViewerThroughHost(
  source: string,
  event: Event,
): Promise<HostActionOutcome> {
  if (!event.isTrusted) {
    return { ok: false, message: NEEDS_CLICK_MESSAGE }
  }

  if (!connection) {
    return { ok: false, message: NOT_AVAILABLE_MESSAGE }
  }

  if (source.length > MAX_DIAGRAM_SOURCE_LENGTH) {
    return { ok: false, message: TOO_LARGE_MESSAGE }
  }

  try {
    await connection.request(METHODS.openDiagramViewer, {
      source,
      userActivation: hasUserGesture(event),
    })

    return { ok: true }
  } catch (exception) {
    return describeFailure(exception)
  }
}
