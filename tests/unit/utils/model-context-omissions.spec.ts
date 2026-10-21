import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  getModelContextOmissionLabel,
  getOmittedContextFileName,
  getOmittedContextFiles,
  getOmittedContextFilesSummary,
  isOmittedContextFilesPart,
} from '../../../shared/utils/model-context-omissions'

function createMessage(parts: unknown[]): UIMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    parts,
  } as UIMessage
}

describe('isOmittedContextFilesPart', () => {
  it('accepts an omitted context files part with a files array', () => {
    expect(isOmittedContextFilesPart({
      type: 'data-omitted-context-files',
      data: { files: [] },
    } as never)).toBe(true)
  })

  it('rejects other part types', () => {
    expect(isOmittedContextFilesPart({
      type: 'data-missing-files',
      data: { files: [] },
    } as never)).toBe(false)
  })

  it('rejects a part without a files array', () => {
    expect(isOmittedContextFilesPart({
      type: 'data-omitted-context-files',
      data: {},
    } as never)).toBe(false)
    expect(isOmittedContextFilesPart({
      type: 'data-omitted-context-files',
    } as never)).toBe(false)
    expect(isOmittedContextFilesPart({
      type: 'data-omitted-context-files',
      data: null,
    } as never)).toBe(false)
  })
})

describe('getOmittedContextFiles', () => {
  it('returns the data of the part', () => {
    const data = {
      modelName: 'GPT',
      files: [{
        filename: 'a.pdf',
        mediaType: 'application/pdf',
        reason: 'over-limit',
      }],
    }

    expect(getOmittedContextFiles(createMessage([
      { type: 'text', text: 'answer' },
      { type: 'data-omitted-context-files', data },
    ]))).toEqual(data)
  })

  it('returns null without the part', () => {
    expect(getOmittedContextFiles(createMessage([
      { type: 'text', text: 'answer' },
    ]))).toBeNull()
  })

  it('returns null for an empty files list', () => {
    expect(getOmittedContextFiles(createMessage([
      { type: 'data-omitted-context-files', data: { files: [] } },
    ]))).toBeNull()
  })
})

describe('getModelContextOmissionLabel', () => {
  it('uses the model name for unsupported files', () => {
    expect(getModelContextOmissionLabel('unsupported-by-model', 'Gemma'))
      .toBe('Gemma can\'t read this file type')
  })

  it('falls back to a generic model name', () => {
    expect(getModelContextOmissionLabel('unsupported-by-model'))
      .toBe('The selected model can\'t read this file type')
  })

  it('describes the other reasons', () => {
    expect(getModelContextOmissionLabel('outside-window'))
      .toBe('Attached too many messages ago')
    expect(getModelContextOmissionLabel('over-limit'))
      .toBe('Over the size or count limit for earlier files')
    expect(getModelContextOmissionLabel('gateway-no-carry'))
      .toBe('Gateway models only see files from the latest message')
  })
})

describe('getOmittedContextFilesSummary', () => {
  it('uses the singular for one file', () => {
    expect(getOmittedContextFilesSummary(1))
      .toBe('1 earlier file wasn\'t sent to the model')
  })

  it('uses the plural for several files', () => {
    expect(getOmittedContextFilesSummary(3))
      .toBe('3 earlier files weren\'t sent to the model')
  })
})

describe('getOmittedContextFileName', () => {
  it('returns the filename or a fallback', () => {
    expect(getOmittedContextFileName({
      filename: 'a.pdf',
      mediaType: 'application/pdf',
      reason: 'over-limit',
    })).toBe('a.pdf')
    expect(getOmittedContextFileName({
      mediaType: 'application/pdf',
      reason: 'over-limit',
    })).toBe('Unnamed file')
  })
})
