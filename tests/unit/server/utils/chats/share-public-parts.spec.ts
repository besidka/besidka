import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  dropEmptyUserMessages,
  filterPublicParts,
} from '~~/server/utils/chats/share-public-parts'

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

  it('drops the skill invocation and activation parts, so a skill name never reaches a share', () => {
    const parts = [
      { type: 'text', text: 'Translate this' },
      {
        type: 'data-skill-invocation',
        data: { skillId: 'skl1', name: 'private-skill-name', version: 2 },
      },
      {
        type: 'data-skill-activation',
        data: { skillId: 'skl1', name: 'private-skill-name', version: 2 },
      },
      {
        type: 'tool-activate_skill',
        toolCallId: 't1',
        state: 'output-available',
        input: { name: 'private-skill-name' },
        output: { skillId: 'skl1', name: 'private-skill-name', version: 2 },
      },
    ] as unknown as UIMessage['parts']

    const [message] = filterPublicParts([{ id: 'm1', parts }])

    expect(message?.parts.map(part => part.type)).toEqual(['text'])
    expect(JSON.stringify(message)).not.toContain('private-skill-name')
  })

  it('leaves a message that only attached a skill with no visible parts', () => {
    const parts = [{
      type: 'data-skill-invocation',
      data: { skillId: 'skl1', name: 'private-skill-name', version: 2 },
    }] as unknown as UIMessage['parts']

    const [message] = filterPublicParts([{ id: 'm1', parts }])

    expect(message?.parts).toEqual([])
  })
})

describe('dropEmptyUserMessages', () => {
  it('skips a user message that only attached a skill, keeps everything else', () => {
    const messages = filterPublicParts([
      {
        id: 'u1',
        role: 'user',
        parts: [{
          type: 'data-skill-invocation',
          data: { skillId: 'skl1', name: 'private', version: 1 },
        }],
      },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Done' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Thanks' }] },
    ] as unknown as Array<{
      id: string
      role: string
      parts: UIMessage['parts']
    }>)

    expect(dropEmptyUserMessages(messages).map(message => message.id))
      .toEqual(['a1', 'u2'])
  })

  it('never drops an assistant message', () => {
    const messages = [{ id: 'a1', role: 'assistant', parts: [] }]

    expect(dropEmptyUserMessages(messages)).toHaveLength(1)
  })
})
