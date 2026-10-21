import { describe, expect, it } from 'vitest'
import { HIDDEN_FILE_MEDIA_TYPE } from '../../../../shared/utils/files'
import {
  assertInputFilesSupported,
  findUnsupportedInputFileKind,
  hasImageFilePart,
} from '../../../../server/utils/chats/input-file-support'

function filePart(mediaType: string) {
  return { type: 'file', mediaType }
}

describe('findUnsupportedInputFileKind', () => {
  it('always accepts text files and text parts', () => {
    expect(findUnsupportedInputFileKind(
      [{ type: 'text' }, filePart('text/plain; charset=utf-8')],
      ['text'],
    )).toBeUndefined()
  })

  it('reports an image the model cannot see', () => {
    expect(findUnsupportedInputFileKind(
      [filePart('image/png')],
      ['text'],
    )).toBe('image')
  })

  it('reports a PDF the model cannot read', () => {
    expect(findUnsupportedInputFileKind(
      [filePart('application/pdf')],
      ['text', 'image'],
    )).toBe('pdf')
  })

  it('accepts a PDF for a model that advertises pdf', () => {
    expect(findUnsupportedInputFileKind(
      [filePart('Application/PDF')],
      ['text', 'pdf'],
    )).toBeUndefined()
  })

  it('leaves other file types to the file policy', () => {
    expect(findUnsupportedInputFileKind(
      [filePart('audio/mpeg')],
      ['text'],
    )).toBeUndefined()
  })

  it('ignores hidden file markers', () => {
    expect(findUnsupportedInputFileKind(
      [filePart(HIDDEN_FILE_MEDIA_TYPE)],
      ['text'],
    )).toBeUndefined()
  })
})

describe('hasImageFilePart', () => {
  it('detects image file parts only', () => {
    expect(hasImageFilePart([filePart('image/webp')])).toBe(true)
    expect(hasImageFilePart([filePart('application/pdf')])).toBe(false)
    expect(hasImageFilePart([{ type: 'text' }])).toBe(false)
  })
})

describe('assertInputFilesSupported', () => {
  const textOnlyModalities = ['text']

  it('keeps the established image error wording', () => {
    expect(() => {
      assertInputFilesSupported(
        [filePart('image/png')],
        textOnlyModalities,
        'Text Model',
      )
    }).toThrowError(expect.objectContaining({
      status: 400,
      message: 'Text Model does not support image input.',
      why: 'The message includes an image attachment, but the selected model does not advertise image support.',
      fix: 'Remove the image attachment, or switch to a vision-capable model.',
    }))
  })

  it('throws the PDF error', () => {
    expect(() => {
      assertInputFilesSupported(
        [filePart('application/pdf')],
        textOnlyModalities,
        'Text Model',
      )
    }).toThrowError(expect.objectContaining({
      status: 400,
      message: 'Text Model does not support PDF input.',
      why: 'The message includes a PDF attachment, but the selected model does not advertise PDF support.',
      fix: 'Remove the PDF, attach its text as a .txt file, or switch to a model that reads PDFs.',
    }))
  })

  it('does not throw for other file types', () => {
    expect(() => {
      assertInputFilesSupported(
        [filePart('audio/mpeg')],
        textOnlyModalities,
        'Text Model',
      )
    }).not.toThrow()
  })

  it('does not read modalities when the message has no files', () => {
    expect(() => {
      assertInputFilesSupported(
        [{ type: 'text' }],
        undefined as any,
        'No Modalities',
      )
    }).not.toThrow()
  })
})
