import type { ConnectorImageMediaType } from '#shared/utils/connectors-policy'

const KIBIBYTE = 1024
const MEBIBYTE = 1024 * KIBIBYTE
const SHOWN_SUFFIX = 'shown to the model, not saved'
const GONE_SUFFIX = 'no longer available; call the tool again to see it'
const REMOTE_PREFIX = '[text from the connector: '
const SHOWN_LINE_PATTERN = new RegExp(
  `\\[(image/(?:png|jpeg|gif|webp)), (\\d+(?:\\.\\d)? (?:B|KB|MB)): ${
    SHOWN_SUFFIX
  }\\]`,
  'g',
)
const LOOKALIKE_PATTERN = new RegExp(
  `\\[([^\\]\\n]{0,200}: (?:${SHOWN_SUFFIX}|${GONE_SUFFIX})\\])`,
  'g',
)

/**
 * A byte count for the placeholder: `512 B`, `412 KB`, `3.5 MB` (1024
 * based, one decimal at most).
 */
export function formatImageSize(bytes: number): string {
  if (bytes < KIBIBYTE) {
    return `${bytes} B`
  }

  if (bytes < MEBIBYTE) {
    return `${Math.round(bytes / KIBIBYTE)} KB`
  }

  return `${Math.round((bytes / MEBIBYTE) * 10) / 10} MB`
}

/**
 * The placeholder an image forwarded to the model leaves in the tool's
 * text, which is what the chat shows and stores: `[image/png, 412 KB: shown
 * to the model, not saved]`. `isGone` builds the line a replay shows once
 * the bytes are gone.
 */
export function buildConnectorImageLine(
  image: { mediaType: ConnectorImageMediaType, bytes: number },
  isGone = false,
): string {
  return `[${image.mediaType}, ${formatImageSize(image.bytes)}: ${
    isGone ? GONE_SUFFIX : SHOWN_SUFFIX
  }]`
}

/**
 * Rewrites text a connector wrote that looks like an image placeholder, so
 * `[image/png, 1 KB: shown to the model, not saved]` from the server becomes
 * `[text from the connector: image/png, 1 KB: shown to the model, not
 * saved]`. Only Besidka writes the real line, and only the real line is
 * rewritten on a replay.
 */
export function neutralizeConnectorImagePlaceholders(text: string): string {
  if (!text.includes(SHOWN_SUFFIX) && !text.includes(GONE_SUFFIX)) {
    return text
  }

  return text.replace(LOOKALIKE_PATTERN, `${REMOTE_PREFIX}$1`)
}

/**
 * Rewrites every "shown to the model" image line in a stored tool output to
 * say the image is no longer available. Used where an earlier result is
 * replayed to a model without its bytes; any value that is not a string is
 * returned as it is.
 */
export function toReplayedConnectorImageText<Value>(value: Value): Value {
  if (typeof value !== 'string' || !value.includes(SHOWN_SUFFIX)) {
    return value
  }

  return value.replace(SHOWN_LINE_PATTERN, (_line, mediaType, size) => {
    return `[${mediaType}, ${size}: ${GONE_SUFFIX}]`
  }) as Value
}
