import { describe, expect, it } from 'vitest'
import {
  findLastDocumentPartIndex,
  getDocumentPartView,
  hasStreamingDocumentPart,
  isDocumentPart,
  isLastDocumentPart,
} from '../../../app/utils/document-parts'

const TOOL_OUTPUT = {
  documentId: 'doc1',
  format: 'pdf',
  title: 'Quarterly report',
  specVersion: 1,
  stats: { pages: 2, slides: null, sheets: null, cells: null, images: 0 },
}

function toolPart(state: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'tool-create_document',
    toolCallId: 'call_1',
    state,
    ...extra,
  }
}

function dataPart(overrides: Record<string, unknown> = {}) {
  return {
    type: 'data-document',
    data: {
      documentId: 'doc1',
      format: 'docx',
      title: 'Plan',
      specVersion: 1,
      status: 'spec_ready',
      ...overrides,
    },
  }
}

describe('isDocumentPart', () => {
  it('matches the tool part and the data part only', () => {
    expect(isDocumentPart(toolPart('input-streaming'))).toBe(true)
    expect(isDocumentPart(dataPart())).toBe(true)
    expect(isDocumentPart({ type: 'data-artifact' })).toBe(false)
    expect(isDocumentPart({ type: 'text', text: 'hi' })).toBe(false)
    expect(isDocumentPart(null)).toBe(false)
    expect(isDocumentPart('data-document')).toBe(false)
  })
})

describe('getDocumentPartView tool parts', () => {
  it('counts partial blocks while the input streams', () => {
    const view = getDocumentPartView(toolPart('input-streaming', {
      input: {
        format: 'pdf',
        title: 'Quarterly',
        blocks: [{ type: 'heading' }, { type: 'paragraph' }, undefined],
      },
    }))

    expect(view).toMatchObject({
      state: 'streaming',
      documentId: null,
      format: 'pdf',
      title: 'Quarterly',
      blockCount: 3,
      toolCallId: 'call_1',
    })
  })

  it('counts slides and sheets for presentations and workbooks', () => {
    const slides = getDocumentPartView(toolPart('input-streaming', {
      input: { format: 'pptx', slides: [{}, {}] },
    }))
    const sheets = getDocumentPartView(toolPart('input-streaming', {
      input: { format: 'xlsx', sheets: [{}] },
    }))

    expect(slides).toMatchObject({ format: 'pptx', blockCount: 2 })
    expect(sheets).toMatchObject({ format: 'xlsx', blockCount: 1 })
  })

  it('reads a streaming part without any input yet', () => {
    const view = getDocumentPartView(toolPart('input-streaming'))

    expect(view).toMatchObject({
      state: 'streaming',
      format: null,
      title: '',
      blockCount: 0,
    })
  })

  it('reads a spec nested under a spec key', () => {
    const view = getDocumentPartView(toolPart('input-streaming', {
      input: { spec: { format: 'docx', title: 'Nested', blocks: [{}] } },
    }))

    expect(view).toMatchObject({
      format: 'docx',
      title: 'Nested',
      blockCount: 1,
    })
  })

  it('maps input-available to the creating state', () => {
    const view = getDocumentPartView(toolPart('input-available', {
      input: { format: 'docx', title: 'Plan', blocks: [{}, {}] },
    }))

    expect(view).toMatchObject({
      state: 'creating',
      documentId: null,
      format: 'docx',
      blockCount: 2,
    })
  })

  it('maps the tool output to a part ready to render', () => {
    const view = getDocumentPartView(toolPart('output-available', {
      input: { format: 'pdf', title: 'Draft title', blocks: [{}] },
      output: TOOL_OUTPUT,
    }))

    expect(view).toMatchObject({
      state: 'ready-to-render',
      documentId: 'doc1',
      format: 'pdf',
      title: 'Quarterly report',
      specVersion: 1,
      persistedStatus: 'spec_ready',
      blockCount: 1,
    })
  })

  it('ignores a finished call whose output is malformed', () => {
    expect(getDocumentPartView(toolPart('output-available', {
      output: { documentId: '', format: 'pdf' },
    }))).toBeNull()
    expect(getDocumentPartView(toolPart('output-available', {
      output: { documentId: 'doc1', format: 'rtf' },
    }))).toBeNull()
    expect(getDocumentPartView(toolPart('output-available'))).toBeNull()
  })

  it('maps tool errors to the failed state with a readable reason', () => {
    const view = getDocumentPartView(toolPart('output-error', {
      input: { format: 'xlsx', title: 'Budget' },
      errorText: JSON.stringify({
        code: 'invalid-provider-output',
        message: 'The spec is invalid.',
        why: 'The sheet name is reserved.',
        status: 422,
        requestId: 'a57e4bba8acae3a',
      }),
    }))

    expect(view).toMatchObject({
      state: 'failed',
      format: 'xlsx',
      title: 'Budget',
      errorTitle: 'The spec is invalid.',
      errorText: 'The sheet name is reserved.',
    })
    expect(view?.errorText).not.toContain('a57e4bba8acae3a')
  })

  it('keeps a plain error sentence as the reason', () => {
    const view = getDocumentPartView(toolPart('output-denied', {
      errorText: 'Too many documents in one reply.',
    }))

    expect(view).toMatchObject({
      state: 'failed',
      errorTitle: '',
      errorText: 'Too many documents in one reply.',
    })
  })

  it('returns null for unknown tool states', () => {
    expect(getDocumentPartView(toolPart('approval-requested'))).toBeNull()
  })
})

describe('getDocumentPartView data parts', () => {
  it('normalises a persisted reference', () => {
    expect(getDocumentPartView(dataPart())).toMatchObject({
      state: 'ready-to-render',
      documentId: 'doc1',
      format: 'docx',
      title: 'Plan',
      specVersion: 1,
      persistedStatus: 'spec_ready',
      blockCount: 0,
      toolCallId: null,
    })
  })

  it('treats rendering and ready references as ready to render', () => {
    expect(getDocumentPartView(dataPart({ status: 'rendering' })))
      .toMatchObject({ state: 'ready-to-render', persistedStatus: 'rendering' })
    expect(getDocumentPartView(dataPart({ status: 'ready' })))
      .toMatchObject({ state: 'ready-to-render', persistedStatus: 'ready' })
  })

  it('maps a failed reference to the failed state', () => {
    expect(getDocumentPartView(dataPart({ status: 'failed' })))
      .toMatchObject({ state: 'failed', persistedStatus: 'failed' })
  })

  it('normalises a shared-view reference without a document id', () => {
    const view = getDocumentPartView(dataPart({
      documentId: null,
      status: 'ready',
      file: { url: '/shared/x/file', name: 'Plan.docx', size: 10, type: 'x' },
    }))

    expect(view).toMatchObject({
      state: 'ready-to-render',
      documentId: null,
      format: 'docx',
      persistedStatus: 'ready',
    })
  })

  it('rejects malformed data parts and foreign parts', () => {
    expect(getDocumentPartView(dataPart({ format: 'rtf' }))).toBeNull()
    expect(getDocumentPartView(dataPart({ status: 'unknown' }))).toBeNull()
    expect(getDocumentPartView(dataPart({ documentId: '' }))).toBeNull()
    expect(getDocumentPartView({ type: 'data-artifact', data: {} })).toBeNull()
    expect(getDocumentPartView(null)).toBeNull()
    expect(getDocumentPartView([])).toBeNull()
  })
})

describe('document part position helpers', () => {
  const parts = [
    { type: 'text', text: 'Here you go' },
    dataPart({ documentId: 'doc1' }),
    { type: 'text', text: 'And another' },
    dataPart({ documentId: 'doc2' }),
  ]

  it('finds the last document part', () => {
    expect(findLastDocumentPartIndex(parts)).toBe(3)
    expect(findLastDocumentPartIndex([{ type: 'text', text: 'x' }])).toBe(-1)
    expect(findLastDocumentPartIndex([])).toBe(-1)
  })

  it('marks only the last document part', () => {
    expect(isLastDocumentPart(parts, 1)).toBe(false)
    expect(isLastDocumentPart(parts, 3)).toBe(true)
    expect(isLastDocumentPart(parts, 0)).toBe(false)
    expect(isLastDocumentPart(parts, 9)).toBe(false)
  })

  it('detects a document that is still being written', () => {
    expect(hasStreamingDocumentPart(parts)).toBe(false)
    expect(hasStreamingDocumentPart([
      ...parts,
      toolPart('input-streaming'),
    ])).toBe(true)
    expect(hasStreamingDocumentPart([toolPart('input-available')])).toBe(true)
    expect(hasStreamingDocumentPart([
      toolPart('output-available', { output: TOOL_OUTPUT }),
    ])).toBe(false)
  })
})
