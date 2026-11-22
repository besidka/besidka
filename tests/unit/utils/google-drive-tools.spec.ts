import { describe, expect, it } from 'vitest'
import {
  GOOGLE_DRIVE_LIST_TOOL_NAME,
  GOOGLE_DRIVE_READ_TOOL_NAME,
  GOOGLE_DRIVE_SAVE_FAILURE_MESSAGES,
  GOOGLE_DRIVE_SAVE_FAILURE_STATUS,
  GOOGLE_DRIVE_SAVE_TOOL_NAME,
  GOOGLE_DRIVE_TOOL_NAMES,
  getGoogleDriveToolStepTitle,
  isGoogleDriveToolName,
} from '#shared/utils/google-drive-tools'
import { isGoogleToolName } from '#shared/utils/google-tool-approvals'

describe('Google Drive tool names', () => {
  it('start with the google__ prefix', () => {
    for (const name of GOOGLE_DRIVE_TOOL_NAMES) {
      expect(isGoogleToolName(name)).toBe(true)
    }
  })

  it('recognizes a Drive tool in any letter case and nothing else', () => {
    expect(isGoogleDriveToolName('Google__Drive_Read_File')).toBe(true)
    expect(isGoogleDriveToolName('google__calendar_create_event')).toBe(false)
    expect(isGoogleDriveToolName('besidka__read_file')).toBe(false)
    expect(isGoogleDriveToolName(null)).toBe(false)
  })
})

describe('Google Drive save failures', () => {
  it('has a status and a sentence for every code', () => {
    const codes = Object.keys(GOOGLE_DRIVE_SAVE_FAILURE_MESSAGES)

    expect(Object.keys(GOOGLE_DRIVE_SAVE_FAILURE_STATUS).sort())
      .toEqual(codes.sort())

    for (const message of Object.values(GOOGLE_DRIVE_SAVE_FAILURE_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10)
    }
  })
})

describe('getGoogleDriveToolStepTitle', () => {
  it.each([
    [GOOGLE_DRIVE_LIST_TOOL_NAME, 'Listing Google Drive files'],
    [GOOGLE_DRIVE_READ_TOOL_NAME, 'Reading a file from Google Drive'],
    [GOOGLE_DRIVE_SAVE_TOOL_NAME, 'Saving a file to Google Drive'],
  ])('names Google Drive in full for %s while it runs', (name, title) => {
    expect(getGoogleDriveToolStepTitle(name, true, false)).toBe(title)
    expect(getGoogleDriveToolStepTitle(name, false, false)).toContain(
      'Google Drive',
    )
    expect(getGoogleDriveToolStepTitle(name, false, true)).toContain(
      'failed',
    )
  })

  it('gives a tool it does not know a generic Google Drive title', () => {
    expect(getGoogleDriveToolStepTitle('google__x', false, false))
      .toBe('Used Google Drive')
  })
})
