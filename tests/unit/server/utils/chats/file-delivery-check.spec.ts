import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OFFICE_MEDIA_TYPES } from '#shared/utils/office-files'

const mocks = vi.hoisted(() => ({
  getOwnedFilesByStorageKeys: vi.fn(),
  ensureOfficeTextState: vi.fn(),
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/files/file-governance', () => ({
  getOwnedFilesByStorageKeys: mocks.getOwnedFilesByStorageKeys,
}))

vi.mock('~~/server/utils/files/office-text', () => ({
  ensureOfficeTextState: mocks.ensureOfficeTextState,
}))

const {
  assertFilesDeliverable,
  assertOnlyDeliverableFileParts,
} = await import('~~/server/utils/chats/file-delivery-check')

function part(key: string, mediaType: string, filename = key) {
  return { type: 'file', url: `/files/${key}`, mediaType, filename }
}

function owned(
  key: string,
  type: string,
  overrides: Record<string, unknown> = {},
) {
  return [key, {
    id: key,
    storageKey: key,
    size: 10,
    type,
    textStatus: 'ready',
    textBytes: 5,
    textVersion: 1,
    ...overrides,
  }] as const
}

function check(
  parts: ReturnType<typeof part>[],
  overrides: Record<string, unknown> = {},
) {
  return assertFilesDeliverable({
    parts: [{ type: 'text' }, ...parts],
    userId: 1,
    route: 'direct',
    providerId: 'anthropic',
    modalities: ['text', 'image', 'pdf'],
    modelName: 'Claude',
    logger: { set: mocks.loggerSet },
    ...overrides,
  })
}

describe('assertFilesDeliverable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureOfficeTextState.mockImplementation(async (file: any) => {
      return file.textStatus
        ? { textStatus: file.textStatus, textBytes: 5, textVersion: 1 }
        : null
    })
  })

  it('passes a message with no files without a lookup', async () => {
    await check([])

    expect(mocks.getOwnedFilesByStorageKeys).not.toHaveBeenCalled()
  })

  it('accepts a ready Office file, an image and a text file', async () => {
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      owned('a.docx', OFFICE_MEDIA_TYPES.docx),
      owned('b.png', 'image/png', { textStatus: null }),
      owned('c.txt', 'text/plain', { textStatus: null }),
    ]))

    await expect(check([
      part('a.docx', OFFICE_MEDIA_TYPES.docx),
      part('b.png', 'image/png'),
      part('c.txt', 'text/plain'),
    ])).resolves.toBeUndefined()
  })

  it('names the file and the reason when no text could be read', async () => {
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      owned('a.docx', OFFICE_MEDIA_TYPES.docx, { textStatus: 'failed' }),
    ]))

    await expect(check([
      part('a.docx', OFFICE_MEDIA_TYPES.docx, 'plan.docx'),
    ])).rejects.toMatchObject({
      status: 400,
      message: 'plan.docx cannot be sent to Claude.',
      why: expect.stringMatching(/No text could be read/),
      fix: expect.stringMatching(/\.docx, \.xlsx or \.pptx/),
    })
  })

  it('treats an unavailable renderer as unreadable, not as a provider error', async () => {
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      owned('a.docx', OFFICE_MEDIA_TYPES.docx, { textStatus: null }),
    ]))

    await expect(check([
      part('a.docx', OFFICE_MEDIA_TYPES.docx),
    ])).rejects.toMatchObject({ status: 400 })
  })

  it('judges the stored type, not the declared one', async () => {
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      owned('a.docx', OFFICE_MEDIA_TYPES.docx, { textStatus: 'failed' }),
    ]))

    await expect(check([part('a.docx', 'image/png')]))
      .rejects.toMatchObject({ status: 400 })
  })

  it('rejects a legacy Office file', async () => {
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      owned('old.doc', 'application/msword', { textStatus: null }),
    ]))

    await expect(check([part('old.doc', 'application/msword')]))
      .rejects.toMatchObject({
        status: 400,
        why: expect.stringMatching(/Legacy/),
      })
  })

  it('rejects an image for a text-only model', async () => {
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      owned('b.png', 'image/png', { textStatus: null }),
    ]))

    await expect(check(
      [part('b.png', 'image/png')],
      { modalities: ['text'] },
    )).rejects.toMatchObject({
      status: 400,
      why: expect.stringMatching(/image support/),
    })
  })

  it('rejects an unknown stored type', async () => {
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      owned('x.bin', 'application/octet-stream', { textStatus: null }),
    ]))

    await expect(check([part('x.bin', 'text/plain')]))
      .rejects.toMatchObject({ status: 400 })
  })

  it('leaves files the user does not own to the file policy', async () => {
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map())

    await expect(check([part('gone.docx', OFFICE_MEDIA_TYPES.docx)]))
      .resolves.toBeUndefined()
  })
})

describe('assertOnlyDeliverableFileParts', () => {
  it('lets images and PDFs through', () => {
    expect(() => {
      assertOnlyDeliverableFileParts([{
        parts: [
          { type: 'text' },
          { type: 'file', mediaType: 'image/jpeg' },
          { type: 'file', mediaType: 'application/pdf' },
        ],
      }])
    }).not.toThrow()
  })

  for (const mediaType of [
    OFFICE_MEDIA_TYPES.docx,
    OFFICE_MEDIA_TYPES.xlsx,
    OFFICE_MEDIA_TYPES.pptx,
    'text/markdown',
    'text/csv',
    'text/plain',
    'application/octet-stream',
    'application/json',
    '',
  ]) {
    it(`stops a "${mediaType}" file part with a 400`, () => {
      expect(() => {
        assertOnlyDeliverableFileParts([{
          parts: [{ type: 'file', mediaType, filename: 'x' }],
        }])
      }).toThrowError(expect.objectContaining({
        status: 400,
        message: 'x cannot be sent to the model.',
      }))
    })
  }
})

describe('assertOnlyDeliverableFileParts for inline sandbox files', () => {
  const options = { inlineContainerFiles: true }

  it('allows exactly the Office and JSON types', () => {
    for (const mediaType of [
      OFFICE_MEDIA_TYPES.docx,
      OFFICE_MEDIA_TYPES.xlsx,
      OFFICE_MEDIA_TYPES.pptx,
      'application/json',
    ]) {
      expect(() => {
        assertOnlyDeliverableFileParts(
          [{ parts: [{ type: 'file', mediaType }] }],
          options,
        )
      }).not.toThrow()
    }
  })

  it('still stops everything else', () => {
    for (const mediaType of [
      'text/markdown',
      'text/csv',
      'application/zip',
      'application/octet-stream',
      'application/msword',
      '',
    ]) {
      expect(() => {
        assertOnlyDeliverableFileParts(
          [{ parts: [{ type: 'file', mediaType }] }],
          options,
        )
      }, mediaType).toThrowError(expect.objectContaining({ status: 400 }))
    }
  })

  it('allows nothing extra when the option is off', () => {
    expect(() => {
      assertOnlyDeliverableFileParts([{
        parts: [{ type: 'file', mediaType: 'application/json' }],
      }])
    }).toThrowError(expect.objectContaining({ status: 400 }))
  })
})

describe('assertFilesDeliverable with Run code files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureOfficeTextState.mockResolvedValue({
      textStatus: 'failed',
      textBytes: null,
      textVersion: 1,
    })
  })

  it('accepts an unreadable Office file and a JSON file when the sandbox gets files', async () => {
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      owned('a.docx', OFFICE_MEDIA_TYPES.docx),
      owned('o.json', 'application/json', { textStatus: null }),
    ]))

    await expect(check([
      part('a.docx', OFFICE_MEDIA_TYPES.docx),
      part('o.json', 'application/json'),
    ], { codeExecutionFiles: true })).resolves.toBeUndefined()
  })

  it('refuses them again for a provider without a sandbox', async () => {
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(new Map([
      owned('o.json', 'application/json', { textStatus: null }),
    ]))

    await expect(check(
      [part('o.json', 'application/json')],
      { codeExecutionFiles: true, providerId: 'deepseek' },
    )).rejects.toMatchObject({ status: 400 })
  })
})
