import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { getGoogleStepData } from '../../../app/utils/google-step'
import {
  REASONING_STEP_GENERIC_ICON,
  resolveReasoningStepSource,
} from '../../../app/utils/reasoning-step-icons'
import { getToolStepTitle } from '../../../app/utils/reasoning'
import {
  getApprovalStepSummaryLine,
  getApprovalStepTitle,
} from '../../../app/utils/tool-approval-step'

type Part = UIMessage['parts'][number]

function part(overrides: Record<string, unknown>): Part {
  return {
    type: 'tool-google__drive_read_file',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { fileId: 'file-1' },
    ...overrides,
  } as unknown as Part
}

const LINK = 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz'

describe('getGoogleStepData', () => {
  it('returns null for a part that is not a Google tool', () => {
    expect(getGoogleStepData(part({ type: 'tool-memory_list' }))).toBeNull()
    expect(getGoogleStepData({ type: 'text', text: 'hi' } as Part))
      .toBeNull()
  })

  it('reads the stored references of a finished call', () => {
    expect(getGoogleStepData(part({
      output: {
        bodyRemoved: true,
        note: 'x',
        references: [{
          id: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
          kind: 'drive-file',
          title: 'Plan.md',
          link: LINK,
          date: '2026-11-20T10:00:00.000Z',
        }],
      },
    }))).toEqual({
      toolName: 'google__drive_read_file',
      state: 'done',
      references: [{
        id: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
        title: 'Plan.md',
        link: LINK,
        date: '2026-11-20T10:00:00.000Z',
      }],
    })
  })

  it('never keeps a link that is not https', () => {
    const data = getGoogleStepData(part({
      output: {
        references: [
          { id: 'a', title: 'A', link: 'javascript:alert(1)' },
          { id: 'b', title: 'B', link: 'http://drive.google.com/x' },
        ],
      },
    }))

    expect(data?.references.map(reference => reference.link)).toEqual(['', ''])
  })

  it('shows no references while the call runs or after it failed', () => {
    expect(getGoogleStepData(part({
      state: 'input-available',
      output: undefined,
    }))).toMatchObject({ state: 'working', references: [] })
    expect(getGoogleStepData(part({
      state: 'output-error',
      errorText: 'The Google tool did not return a result.',
    }))).toMatchObject({ state: 'failed', references: [] })
  })

  it('ignores an output with no references list', () => {
    expect(getGoogleStepData(part({ output: { text: 'body' } })))
      .toMatchObject({ references: [] })
  })

  it('reads a dynamic Google tool part too', () => {
    expect(getGoogleStepData(part({
      type: 'dynamic-tool',
      toolName: 'google__drive_list_picked',
      output: { references: [{ id: 'a', title: 'A' }] },
    }))?.references).toHaveLength(1)
  })
})

describe('Google Drive approval step', () => {
  function model(overrides: Record<string, unknown> = {}) {
    return {
      toolName: 'google__drive_save_file',
      tool: 'google__drive_save_file',
      connectorSlug: undefined,
      isBesidka: false,
      summary: 'Save "Report.md" to your Google Drive as "Final.md"',
      ...overrides,
    } as never
  }

  it('shows the server summary that names the file as the title', () => {
    expect(getApprovalStepTitle(model(), undefined))
      .toBe('Save "Report.md" to your Google Drive as "Final.md"')
  })

  it('falls back to a plain sentence when the summary is empty', () => {
    expect(getApprovalStepTitle(model({ summary: '' }), undefined))
      .toBe('Besidka wants to drive save file on Google')
  })

  it('has no extra summary line and uses the Drive icon', () => {
    expect(getApprovalStepSummaryLine(model())).toBe('')
    expect(resolveReasoningStepSource({
      toolName: 'google__drive_save_file',
      title: 'Save a file',
    }).icon).toEqual({ kind: 'iconify', name: 'logos:google-drive' })
  })
})

describe('Google Drive reasoning step', () => {
  it('names Google Drive in full in the title', () => {
    expect(getToolStepTitle('google__drive_read_file', false, false))
      .toBe('Read a file from Google Drive')
    expect(getToolStepTitle('google__drive_save_file', true, false))
      .toBe('Saving a file to Google Drive')
    expect(getToolStepTitle('google__drive_list_picked', false, true))
      .toBe('Listing Google Drive files failed')
  })

  it('uses a neutral pinned-collection icon, never a Google logo', () => {
    const source = resolveReasoningStepSource({
      toolName: 'google__drive_read_file',
      title: 'Read a file from Google Drive',
    })

    expect(source.icon).toEqual({ kind: 'iconify', name: 'logos:google-drive' })
    expect(source.icon).not.toEqual({
      kind: 'iconify',
      name: REASONING_STEP_GENERIC_ICON,
    })
    expect(source.label).toBe('Read a file from Google Drive')
  })
})
