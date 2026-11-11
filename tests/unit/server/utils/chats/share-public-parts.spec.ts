import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { filterPublicParts } from '~~/server/utils/chats/share-public-parts'

describe('filterPublicParts', () => {
  it('drops tool parts and artifact attachments, keeps the rest', () => {
    const parts = [
      { type: 'text', text: 'Fix it' },
      {
        type: 'data-artifact-attachment',
        data: {
          artifactId: 'art-1',
          version: 1,
          kind: 'html',
          title: 'Private library page',
        },
      },
      {
        type: 'data-artifact',
        data: {
          artifactId: 'art-2',
          version: 1,
          kind: 'html',
          title: 'Made in this chat',
        },
      },
      {
        type: 'tool-update_artifact',
        toolCallId: 't1',
        state: 'output-available',
        input: {},
        output: {},
      },
    ] as unknown as UIMessage['parts']

    const [message] = filterPublicParts([{ id: 'm1', parts }])

    expect(message?.parts.map(part => part.type)).toEqual([
      'text',
      'data-artifact',
    ])
  })

  it('keeps data-document references and drops create_document tool parts', () => {
    const parts = [
      {
        type: 'data-document',
        data: {
          documentId: 'doc-1',
          format: 'pdf',
          title: 'Report',
          specVersion: 1,
          status: 'ready',
        },
      },
      {
        type: 'tool-create_document',
        toolCallId: 't1',
        state: 'output-error',
        input: { format: 'pdf' },
        errorText: 'The document could not be created.',
      },
    ] as unknown as UIMessage['parts']

    const [message] = filterPublicParts([{ id: 'm1', parts }])

    expect(message?.parts.map(part => part.type)).toEqual(['data-document'])
  })
})
