import type { ConnectorImageMediaType } from '#shared/utils/connectors-policy'

const KIBIBYTE = 1024
const MEBIBYTE = 1024 * KIBIBYTE
const SHOWN_MARKER = 'shown to the model'
const GONE_MARKER = 'call the tool again to see it'
const REMOTE_PREFIX = '[text from the connector: '
const REGEX_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g

export type ConnectorImageSaveStatus = 'saved' | 'not-saved' | 'storage-full'

const SHOWN_SUFFIXES: Record<ConnectorImageSaveStatus, string> = {
  'saved': `${SHOWN_MARKER}, kept with this chat`,
  'storage-full': `${SHOWN_MARKER}, not kept (storage full)`,
  'not-saved': `${SHOWN_MARKER}, not kept`,
}
const GONE_SUFFIX = `no longer available; ${GONE_MARKER}`
const SAVED_GONE_SUFFIX = 'kept with this chat, no longer available to the '
  + `model; ${GONE_MARKER}`

function escapeRegExp(value: string): string {
  return value.replace(REGEX_SPECIAL_CHARACTERS, '\\$&')
}

function alternationOf(values: readonly string[]): string {
  return [...values]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|')
}

const SHOWN_ALTERNATION = alternationOf(Object.values(SHOWN_SUFFIXES))
const SHOWN_LINE_PATTERN = new RegExp(
  `\\[(image/(?:png|jpeg|gif|webp)), (\\d+(?:\\.\\d)? (?:B|KB|MB)): (${
    SHOWN_ALTERNATION
  })\\]`,
  'g',
)
const LOOKALIKE_PATTERN = new RegExp(
  `\\[([^\\]\\n]{0,200}: (?:${alternationOf([
    ...Object.values(SHOWN_SUFFIXES),
    GONE_SUFFIX,
    SAVED_GONE_SUFFIX,
  ])})\\])`,
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
 * to the model, kept with this chat]`, `[...: shown to the model, not kept
 * (storage full)]` or `[...: shown to the model, not kept]`.
 */
export function buildConnectorImageLine(
  image: { mediaType: ConnectorImageMediaType, bytes: number },
  status: ConnectorImageSaveStatus = 'not-saved',
): string {
  return `[${image.mediaType}, ${formatImageSize(image.bytes)}: ${
    SHOWN_SUFFIXES[status]
  }]`
}

/**
 * Rewrites text a connector wrote that looks like an image placeholder, so
 * `[image/png, 1 KB: shown to the model, kept with this chat]` from the
 * server becomes `[text from the connector: image/png, 1 KB: shown to the
 * model, kept with this chat]`. Every variant Besidka writes, and both
 * replay wordings, are covered. Only Besidka writes the real line, and only
 * the real line is rewritten on a replay.
 */
export function neutralizeConnectorImagePlaceholders(text: string): string {
  if (!text.includes(SHOWN_MARKER) && !text.includes(GONE_MARKER)) {
    return text
  }

  return text.replace(LOOKALIKE_PATTERN, `${REMOTE_PREFIX}$1`)
}

/**
 * Rewrites every "shown to the model" image line in a stored tool output to
 * say the image is no longer available to the model, keeping "kept with
 * this chat" for an image that was kept. Used where an earlier result is
 * replayed to a model without its bytes; any value that is not a string is
 * returned as it is.
 */
export function toReplayedConnectorImageText<Value>(value: Value): Value {
  if (typeof value !== 'string' || !value.includes(SHOWN_MARKER)) {
    return value
  }

  return value.replace(
    SHOWN_LINE_PATTERN,
    (_line, mediaType, size, suffix) => {
      const goneSuffix = suffix === SHOWN_SUFFIXES.saved
        ? SAVED_GONE_SUFFIX
        : GONE_SUFFIX

      return `[${mediaType}, ${size}: ${goneSuffix}]`
    },
  ) as Value
}
