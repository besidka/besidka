import { describe, expect, it } from 'vitest'
import { GOOGLE_TOOL_OUTPUT_MAX_BYTES } from '#shared/utils/google-tool-approvals'
import {
  fitGoogleToolOutput,
  googleToolOutputBytes,
} from '~~/server/utils/google/tool-output'

function buildWith(text: string) {
  return (budget: number) => ({
    references: [{ id: 'file-1', title: 'Plan' }],
    content: text.slice(0, budget),
  })
}

describe('googleToolOutputBytes', () => {
  it('counts the UTF-8 bytes of the serialized output', () => {
    expect(googleToolOutputBytes({ a: 'é' })).toBe(
      new TextEncoder().encode('{"a":"é"}').byteLength,
    )
  })

  it('counts an undefined output as nothing', () => {
    expect(googleToolOutputBytes(undefined)).toBe(0)
  })
})

describe('fitGoogleToolOutput', () => {
  it('keeps an output that already fits', () => {
    const output = fitGoogleToolOutput(buildWith('short'), 1000)

    expect(output.content).toBe('short')
  })

  it('halves the text budget until the whole JSON fits the cap', () => {
    const output = fitGoogleToolOutput(
      buildWith('"\n\\'.repeat(60_000)),
      GOOGLE_TOOL_OUTPUT_MAX_BYTES,
    )

    expect(googleToolOutputBytes(output))
      .toBeLessThanOrEqual(GOOGLE_TOOL_OUTPUT_MAX_BYTES)
    expect(output.content.length).toBeGreaterThan(0)
  })

  it('falls back to empty text when nothing smaller fits', () => {
    const output = fitGoogleToolOutput(
      budget => ({
        references: [],
        content: 'x'.repeat(GOOGLE_TOOL_OUTPUT_MAX_BYTES * 2).slice(
          0,
          budget === 0 ? 0 : GOOGLE_TOOL_OUTPUT_MAX_BYTES * 2,
        ),
      }),
      GOOGLE_TOOL_OUTPUT_MAX_BYTES * 2,
    )

    expect(output.content).toBe('')
  })
})
