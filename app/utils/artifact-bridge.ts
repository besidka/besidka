import type { ArtifactBridgeModel } from '#shared/utils/artifacts'

const INVISIBLE_CODE_POINT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00AD, 0x00AD],
  [0x034F, 0x034F],
  [0x061C, 0x061C],
  [0x115F, 0x1160],
  [0x180B, 0x180E],
  [0x200B, 0x200F],
  [0x2028, 0x202E],
  [0x2060, 0x206F],
  [0x3164, 0x3164],
  [0xFE00, 0xFE0F],
  [0xFEFF, 0xFEFF],
  [0xFFA0, 0xFFA0],
  [0xFFF9, 0xFFFB],
  [0x1D173, 0x1D17A],
  [0xE0000, 0xE007F],
  [0xE0100, 0xE01EF],
]

function isInvisibleCodePoint(code: number): boolean {
  return INVISIBLE_CODE_POINT_RANGES.some(([first, last]) => {
    return code >= first && code <= last
  })
}

const CHARACTERS_PER_INPUT_TOKEN_ESTIMATE = 2
const EMPTY_LINE_RUN_PATTERN = /\n(?:[ \t\u00A0\u3000]*\n){3,}/g
const SPACE_RUN_PATTERN = /[ \t\u00A0\u2000-\u200A\u3000]{16,}/g

/**
 * Shows invisible and direction-changing characters as visible
 * `[U+202E]` markers, so a prompt cannot hide or reorder text in the
 * confirmation modal. The text sent to the model is not changed.
 */
export function revealInvisibleCharacters(text: string): string {
  return Array.from(text, (character) => {
    const code = character.codePointAt(0) ?? 0

    if (!isInvisibleCodePoint(code)) {
      return character
    }

    return `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]`
  }).join('')
}

/**
 * The text the confirmation modal shows for a prompt or system text:
 * invisible characters revealed, and long runs of blank lines or spaces
 * collapsed into a visible note, so an artifact cannot push its real
 * instructions out of sight below harmless text. Only the preview changes.
 */
export function formatArtifactBridgePreview(text: string): string {
  return revealInvisibleCharacters(text)
    .replace(EMPTY_LINE_RUN_PATTERN, (run) => {
      const emptyLines = run.split('\n').length - 2

      return `\n[${emptyLines} empty lines]\n`
    })
    .replace(SPACE_RUN_PATTERN, (run) => {
      return `[${run.length} spaces]`
    })
}

export function countLines(text: string): number {
  return text ? text.split('\n').length : 0
}

/**
 * An upper estimate of one call's cost in dollars: the input counted as one
 * token per two characters (generous for Cyrillic and code) and the full
 * output budget. `null` when the model has no published price.
 */
export function estimateArtifactBridgeMaxCost(
  model: Pick<
    ArtifactBridgeModel,
    'inputPricePerMillion' | 'outputPricePerMillion'
  >,
  inputCharacters: number,
  maxOutputTokens: number,
): number | null {
  if (
    model.inputPricePerMillion === null
    || model.outputPricePerMillion === null
  ) {
    return null
  }

  const inputTokens = Math.ceil(
    inputCharacters / CHARACTERS_PER_INPUT_TOKEN_ESTIMATE,
  )

  return (
    inputTokens * model.inputPricePerMillion
    + maxOutputTokens * model.outputPricePerMillion
  ) / 1_000_000
}

export function formatArtifactBridgeCost(cost: number | null): string {
  if (cost === null) {
    return 'unknown (no published price)'
  }

  if (cost < 0.01) {
    return 'under $0.01'
  }

  return `about $${cost.toFixed(2)}`
}
