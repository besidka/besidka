import { describe, expect, it } from 'vitest'
import {
  GOOGLE_TOOLS_WITHHELD_NOTES,
  GOOGLE_TOOLS_WITHHELD_PART_TYPE,
  GOOGLE_TOOLS_WITHHELD_REASONS,
  createGoogleToolsWithheldPart,
  getGoogleToolsWithheldReason,
  isGoogleToolsWithheldReason,
} from '#shared/utils/google-tools-withheld'

describe('Google tools withheld note', () => {
  it('creates a part that holds only the reason code', () => {
    expect(createGoogleToolsWithheldPart('provider_tool_not_removable'))
      .toEqual({
        type: GOOGLE_TOOLS_WITHHELD_PART_TYPE,
        data: { reason: 'provider_tool_not_removable' },
      })
  })

  it('has a fixed text for every reason code', () => {
    for (const reason of GOOGLE_TOOLS_WITHHELD_REASONS) {
      expect(GOOGLE_TOOLS_WITHHELD_NOTES[reason].summary.length)
        .toBeGreaterThan(0)
      expect(GOOGLE_TOOLS_WITHHELD_NOTES[reason].detail.length)
        .toBeGreaterThan(0)
    }
  })

  it('accepts only the known reason codes', () => {
    expect(isGoogleToolsWithheldReason('model_may_not_receive_google_data'))
      .toBe(true)
    expect(isGoogleToolsWithheldReason('something_else')).toBe(false)
    expect(isGoogleToolsWithheldReason(undefined)).toBe(false)
    expect(isGoogleToolsWithheldReason({ reason: 'x' })).toBe(false)
  })

  it('reads the reason from a message and ignores anything else', () => {
    expect(getGoogleToolsWithheldReason({
      parts: [
        { type: 'text', text: 'Hi' },
        createGoogleToolsWithheldPart('model_may_not_receive_google_data'),
      ],
    })).toBe('model_may_not_receive_google_data')
    expect(getGoogleToolsWithheldReason({
      parts: [{ type: 'text', text: 'Hi' }],
    })).toBeNull()
    expect(getGoogleToolsWithheldReason({ parts: [null, 'text'] }))
      .toBeNull()
    expect(getGoogleToolsWithheldReason({
      parts: [{
        type: GOOGLE_TOOLS_WITHHELD_PART_TYPE,
        data: { reason: '<script>alert(1)</script>' },
      }],
    })).toBeNull()
    expect(getGoogleToolsWithheldReason({})).toBeNull()
  })
})
