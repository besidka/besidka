import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { OFFICE_MEDIA_TYPES } from '#shared/utils/office-files'
import { buildModelContextMessages } from '~~/server/utils/files/assistant-files'
import {
  CARRIED_FILES_MAX_BYTES,
  CARRIED_TEXT_FILE_MAX_BYTES,
  REQUEST_FILES_MAX_BYTES,
} from '~~/server/utils/files/file-governance'
import { createCarriedMediaTypePredicate } from '~~/server/utils/files/carried-media-types'

vi.mock('~~/server/utils/files/persist-file', () => ({
  persistFile: vi.fn(),
}))

const DOCX = OFFICE_MEDIA_TYPES.docx
const MEGABYTE = 1024 * 1024

function fileMessage(
  id: string,
  files: Array<{ key: string, mediaType: string }>,
): UIMessage {
  return {
    id,
    role: 'user',
    parts: [
      { type: 'text', text: 'Look' },
      ...files.map((file) => {
        return {
          type: 'file' as const,
          mediaType: file.mediaType,
          filename: file.key,
          url: `/files/${file.key}`,
        }
      }),
    ],
  }
}

function getPartTypes(messages: UIMessage[], id: string): string[] {
  const message = messages.find(candidate => candidate.id === id)

  return (message?.parts ?? []).map((part) => {
    return part.type === 'file' ? `file:${part.filename}` : part.type
  })
}

const textOnly = createCarriedMediaTypePredicate(['text'])

describe('Office files in the carry-over window', () => {
  it('lets every model carry Office files but not other binary types', () => {
    expect(textOnly(DOCX)).toBe(true)
    expect(textOnly(OFFICE_MEDIA_TYPES.xlsx)).toBe(true)
    expect(textOnly(OFFICE_MEDIA_TYPES.pptx)).toBe(true)
    expect(textOnly('audio/mpeg')).toBe(false)
    expect(textOnly('application/msword')).toBe(false)
    expect(createCarriedMediaTypePredicate(['text', 'pdf'])('image/png'))
      .toBe(false)
  })

  it('carries an earlier Office file whose text is ready', () => {
    const { messages, omittedFiles } = buildModelContextMessages([
      fileMessage('earlier', [{ key: 'plan.docx', mediaType: DOCX }]),
      fileMessage('latest', []),
    ], {
      canCarryMediaType: textOnly,
      fileSizesByStorageKey: new Map([['plan.docx', 4 * MEGABYTE]]),
      officeTextBytesByStorageKey: new Map([['plan.docx', 2048]]),
    })

    expect(getPartTypes(messages, 'earlier')).toContain('file:plan.docx')
    expect(omittedFiles).toEqual([])
  })

  it('omits an earlier Office file with no ready text without failing', () => {
    const { messages, omittedFiles } = buildModelContextMessages([
      fileMessage('earlier', [{ key: 'plan.docx', mediaType: DOCX }]),
      fileMessage('latest', []),
    ], {
      canCarryMediaType: textOnly,
      fileSizesByStorageKey: new Map([['plan.docx', 4096]]),
      officeTextBytesByStorageKey: new Map(),
    })

    expect(getPartTypes(messages, 'earlier')).not.toContain('file:plan.docx')
    expect(omittedFiles).toEqual([{
      filename: 'plan.docx',
      mediaType: DOCX,
      reason: 'unsupported-by-model',
    }])
  })

  it('applies the 64 KB text cap to the text bytes, not the file size', () => {
    const { omittedFiles, messages } = buildModelContextMessages([
      fileMessage('earlier', [
        { key: 'big-file-small-text.docx', mediaType: DOCX },
        { key: 'small-file-big-text.docx', mediaType: DOCX },
      ]),
      fileMessage('latest', []),
    ], {
      canCarryMediaType: textOnly,
      fileSizesByStorageKey: new Map([
        ['big-file-small-text.docx', 4 * MEGABYTE],
        ['small-file-big-text.docx', 10 * 1024],
      ]),
      officeTextBytesByStorageKey: new Map([
        ['big-file-small-text.docx', 1024],
        ['small-file-big-text.docx', CARRIED_TEXT_FILE_MAX_BYTES + 1],
      ]),
    })

    expect(getPartTypes(messages, 'earlier'))
      .toContain('file:big-file-small-text.docx')
    expect(omittedFiles.map((file) => {
      return [file.filename, file.reason]
    })).toEqual([['small-file-big-text.docx', 'over-limit']])
  })

  it('counts text bytes against the carried and request budgets', () => {
    const files = new Map([
      ['latest.docx', 9 * MEGABYTE],
      ['older.png', 4 * MEGABYTE],
    ])
    const conversation = [
      fileMessage('earlier', [{ key: 'older.png', mediaType: 'image/png' }]),
      fileMessage('latest', [{ key: 'latest.docx', mediaType: DOCX }]),
    ]
    const imageCapable = createCarriedMediaTypePredicate(['text', 'image'])

    const withoutText = buildModelContextMessages(conversation, {
      canCarryMediaType: imageCapable,
      fileSizesByStorageKey: files,
    })
    const withText = buildModelContextMessages(conversation, {
      canCarryMediaType: imageCapable,
      fileSizesByStorageKey: files,
      officeTextBytesByStorageKey: new Map([['latest.docx', 1024]]),
    })

    expect(REQUEST_FILES_MAX_BYTES - 9 * MEGABYTE)
      .toBeLessThan(4 * MEGABYTE)
    expect(4 * MEGABYTE).toBeLessThan(CARRIED_FILES_MAX_BYTES)
    expect(withoutText.omittedFiles.map((file) => {
      return file.reason
    })).toEqual(['over-limit'])
    expect(withText.omittedFiles).toEqual([])
    expect(getPartTypes(withText.messages, 'earlier'))
      .toContain('file:older.png')
  })

  it('keeps the newest message Office file unfiltered', () => {
    const { messages } = buildModelContextMessages([
      fileMessage('latest', [{ key: 'plan.docx', mediaType: DOCX }]),
    ], {
      canCarryMediaType: textOnly,
      fileSizesByStorageKey: new Map([['plan.docx', 4096]]),
    })

    expect(getPartTypes(messages, 'latest')).toContain('file:plan.docx')
  })
})
