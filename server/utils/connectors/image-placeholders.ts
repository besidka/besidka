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
const SHOWN_AGAIN_SUFFIX = `kept with this chat, ${SHOWN_MARKER} again`
const NO_SHOWN_AGAIN_INDEXES: ReadonlySet<number> = new Set()

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
    SHOWN_AGAIN_SUFFIX,
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
 * model, kept with this chat]`. Every variant Besidka writes, and every
 * replay wording, is covered. Only Besidka writes the real line, and only
 * the real line is rewritten on a replay.
 */
export function neutralizeConnectorImagePlaceholders(text: string): string {
  if (!text.includes(SHOWN_MARKER) && !text.includes(GONE_MARKER)) {
    return text
  }

  return text.replace(LOOKALIKE_PATTERN, `${REMOTE_PREFIX}$1`)
}

/**
 * How many "shown to the model, kept with this chat" lines a stored tool
 * output holds. The Nth of them stands for the Nth saved image of the call
 * (`data-connector-image` part), because only Besidka writes the real line.
 */
export function countKeptConnectorImageLines(value: unknown): number {
  if (typeof value !== 'string' || !value.includes(SHOWN_MARKER)) {
    return 0
  }

  return [...value.matchAll(SHOWN_LINE_PATTERN)].filter((match) => {
    return match[3] === SHOWN_SUFFIXES.saved
  }).length
}

/**
 * Rewrites every "shown to the model" image line in a stored tool output for
 * a replay to a model. A kept image whose index among the kept lines is in
 * `shownAgainIndexes` goes to the model again with the replay and says so
 * (`kept with this chat, shown to the model again`); every other line says
 * the image is no longer available, keeping "kept with this chat" for an
 * image that was kept. Any value that is not a string is returned as it is.
 */
export function toReplayedConnectorImageText<Value>(
  value: Value,
  shownAgainIndexes: ReadonlySet<number> = NO_SHOWN_AGAIN_INDEXES,
): Value {
  if (typeof value !== 'string' || !value.includes(SHOWN_MARKER)) {
    return value
  }

  let keptIndex = 0

  return value.replace(
    SHOWN_LINE_PATTERN,
    (_line, mediaType, size, suffix) => {
      if (suffix !== SHOWN_SUFFIXES.saved) {
        return `[${mediaType}, ${size}: ${GONE_SUFFIX}]`
      }

      const replayedSuffix = shownAgainIndexes.has(keptIndex)
        ? SHOWN_AGAIN_SUFFIX
        : SAVED_GONE_SUFFIX

      keptIndex += 1

      return `[${mediaType}, ${size}: ${replayedSuffix}]`
    },
  ) as Value
}
