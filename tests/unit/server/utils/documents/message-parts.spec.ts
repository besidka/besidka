import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  isDocumentToolName,
  rewriteDocumentToolParts,
} from '~~/server/utils/documents/message-parts'

type Parts = UIMessage['parts']

const MAX_PERSISTED_PARTS_BYTES = 1_500_000
const SPEC_LENGTH = 200_000
const SECRET_MARKER = 'secret-spec-text'

const output = {
  documentId: 'doc-1',
  format: 'docx',
  title: 'Quarterly report',
  specVersion: 1,
  stats: { pages: 3, slides: null, sheets: null, cells: null, images: 0 },
}

function toolPart(state: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'tool-create_document',
    toolCallId: 'call-1',
    state,
    input: {
      format: 'docx',
      title: 'Quarterly report',
      spec: { blocks: [{ type: 'paragraph', text: SECRET_MARKER }] },
    },
    ...extra,
  }
}

describe('isDocumentToolName', () => {
  it('matches only create_document', () => {
    expect(isDocumentToolName('create_document')).toBe(true)
    expect(isDocumentToolName('create_artifact')).toBe(false)
    expect(isDocumentToolName('tool-create_document')).toBe(false)
    expect(isDocumentToolName('')).toBe(false)
  })
})

describe('rewriteDocumentToolParts', () => {
  it('turns a finished call into a data-document reference', () => {
    const parts = rewriteDocumentToolParts([
      { type: 'text', text: 'Here it is.' },
      toolPart('output-available', { output }),
    ] as Parts)

    expect(parts).toEqual([
      { type: 'text', text: 'Here it is.' },
      {
        type: 'data-document',
        data: {
          documentId: 'doc-1',
          format: 'docx',
          title: 'Quarterly report',
          specVersion: 1,
          status: 'spec_ready',
        },
      },
    ])
    expect(JSON.stringify(parts)).not.toContain(SECRET_MARKER)
    expect(JSON.stringify(parts)).not.toContain('stats')
  })

  it('keeps a 200,000 character spec out of the persisted message', () => {
    const hugeSpec = {
      blocks: [{ type: 'paragraph', text: 'x'.repeat(SPEC_LENGTH) }],
    }
    const toolInput = {
      format: 'docx',
      title: 'Quarterly report',
      spec: hugeSpec,
    }

    expect(JSON.stringify(toolInput).length).toBeGreaterThan(SPEC_LENGTH)

    const parts = rewriteDocumentToolParts([
      { type: 'text', text: 'Done.' },
      toolPart('output-available', { input: toolInput, output }),
    ] as Parts)
    const persisted = JSON.stringify(parts)

    expect(persisted).not.toContain('xxxxxxxxxx')
    expect(Buffer.byteLength(persisted)).toBeLessThan(
      MAX_PERSISTED_PARTS_BYTES / 100,
    )
    expect(parts.map(part => part.type)).toEqual(['text', 'data-document'])
  })

  it('keeps a failed call with its format and a fixed error text only', () => {
    const parts = rewriteDocumentToolParts([
      toolPart('output-error', { errorText: `Invalid ${SECRET_MARKER}` }),
    ] as Parts)

    expect(parts).toEqual([{
      type: 'tool-create_document',
      toolCallId: 'call-1',
      state: 'output-error',
      input: { format: 'docx' },
      errorText: 'The document could not be created.',
    }])
    expect(JSON.stringify(parts)).not.toContain(SECRET_MARKER)
    expect(JSON.stringify(parts)).not.toContain('Quarterly report')
  })

  it('drops the format of a failed call whose format is unknown', () => {
    const parts = rewriteDocumentToolParts([
      toolPart('output-error', {
        input: { format: 'exe', spec: SECRET_MARKER },
      }),
      toolPart('output-error', { toolCallId: 'call-2', input: undefined }),
    ] as Parts)

    expect(parts).toEqual([
      {
        type: 'tool-create_document',
        toolCallId: 'call-1',
        state: 'output-error',
        input: {},
        errorText: 'The document could not be created.',
      },
      {
        type: 'tool-create_document',
        toolCallId: 'call-2',
        state: 'output-error',
        input: {},
        errorText: 'The document could not be created.',
      },
    ])
  })

  it('drops an unfinished call from an interrupted stream', () => {
    for (const state of [
      'input-streaming',
      'input-available',
      'approval-requested',
    ]) {
      expect(rewriteDocumentToolParts([
        { type: 'text', text: 'Working on it.' },
        toolPart(state),
      ] as Parts)).toEqual([{ type: 'text', text: 'Working on it.' }])
    }
  })

  it('drops a finished call whose output is not a usable reference', () => {
    expect(rewriteDocumentToolParts([
      toolPart('output-available', { output: undefined }),
      toolPart('output-available', { output: 'string output' }),
      toolPart('output-available', { output: [output] }),
      toolPart('output-available', { output: { ...output, format: 'exe' } }),
      toolPart('output-available', { output: { ...output, documentId: '' } }),
      toolPart('output-available', { output: { ...output, title: 7 } }),
      toolPart('output-available', {
        output: { ...output, specVersion: 1.5 },
      }),
    ] as Parts)).toEqual([])
  })

  it('leaves every other part untouched, including artifact parts', () => {
    const otherParts = [
      { type: 'step-start' },
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'Hello' },
      { type: 'file', url: '/files/a', mediaType: 'image/png' },
      {
        type: 'tool-create_artifact',
        toolCallId: 'call-9',
        state: 'output-available',
        input: { content: 'kept as is' },
        output: { artifactId: 'a' },
      },
      {
        type: 'data-document',
        data: {
          documentId: 'doc-0',
          format: 'pdf',
          title: 'Earlier',
          specVersion: 1,
          status: 'ready',
        },
      },
    ] as Parts

    expect(rewriteDocumentToolParts(otherParts)).toEqual(otherParts)
  })

  it('rewrites several calls in one message independently', () => {
    const parts = rewriteDocumentToolParts([
      toolPart('output-available', { toolCallId: 'a', output }),
      toolPart('output-error', { toolCallId: 'b' }),
      toolPart('output-available', {
        toolCallId: 'c',
        output: { ...output, documentId: 'doc-2', format: 'xlsx' },
      }),
    ] as Parts)

    expect(parts.map(part => part.type)).toEqual([
      'data-document',
      'tool-create_document',
      'data-document',
    ])
    expect((parts[2] as { data: { documentId: string } }).data.documentId)
      .toBe('doc-2')
  })

  it('reduces an invalid-input call the AI SDK stores as dynamic-tool',
    () => {
      const parts = rewriteDocumentToolParts([{
        type: 'dynamic-tool',
        toolName: 'create_document',
        toolCallId: 'call-1',
        state: 'output-error',
        input: {
          specVersion: 1,
          format: 'docx',
          title: SECRET_MARKER,
          blocks: [{ type: 'bogus' }],
        },
        errorText: 'The model sent an invalid tool call.',
      }] as unknown as Parts)

      expect(JSON.stringify(parts)).not.toContain(SECRET_MARKER)
    })
})
