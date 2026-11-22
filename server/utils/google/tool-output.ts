import { GOOGLE_TOOL_OUTPUT_MAX_BYTES } from '#shared/utils/google-tool-approvals'
import type { GoogleToolOutput } from '~~/server/utils/tool-approval/google'

const FIT_ATTEMPTS = 8
const TEXT_ENCODER = new TextEncoder()

export function googleToolOutputBytes(output: unknown): number {
  const serialized = JSON.stringify(output)

  return serialized === undefined
    ? 0
    : TEXT_ENCODER.encode(serialized).byteLength
}

/**
 * Builds a Google tool output that serializes to at most
 * `GOOGLE_TOOL_OUTPUT_MAX_BYTES`. The cap counts the whole JSON (the
 * references, the untrusted frame and the escaping of the text), not only
 * the text, so `build` gets a byte budget for its text and the budget is
 * halved until the serialized output fits; at zero the text is empty. A
 * paused turn keeps a body only when it fits, so a tool must never return
 * more.
 */
export function fitGoogleToolOutput<Output extends GoogleToolOutput>(
  build: (textBudgetBytes: number) => Output,
  initialBudgetBytes: number,
): Output {
  let budget = initialBudgetBytes

  for (let attempt = 0; attempt < FIT_ATTEMPTS; attempt += 1) {
    const output = build(budget)

    if (googleToolOutputBytes(output) <= GOOGLE_TOOL_OUTPUT_MAX_BYTES) {
      return output
    }

    budget = Math.floor(budget / 2)
  }

  return build(0)
}
