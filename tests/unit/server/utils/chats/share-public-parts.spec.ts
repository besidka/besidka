import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  isApprovalOnlyMessage,
  stripToolPartsFromBranchedMessage,
} from '~~/server/utils/chats/branch'
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

describe('connector parts in shares and branches', () => {
  const connectorParts = [
    { type: 'text', text: 'Here are your issues' },
    {
      type: 'dynamic-tool',
      toolName: 'mcp__linear__list_issues',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { query: 'private' },
      output: '<untrusted_tool_result connector="linear" tool="list_issues">'
        + '\nIssue about a customer\n</untrusted_tool_result>',
    },
    {
      type: 'data-connectors-notice',
      data: { lines: ['Linear needs to sign in again.'] },
    },
  ] as unknown as UIMessage['parts']

  it('never exposes a connector call or notice in a public share', () => {
    const [message] = filterPublicParts([{ id: 'm1', parts: connectorParts }])

    expect(message!.parts).toEqual([
      { type: 'text', text: 'Here are your issues' },
    ])
    expect(JSON.stringify(message)).not.toContain('customer')
    expect(JSON.stringify(message)).not.toContain('Linear')
  })

  it('never copies a connector call or notice into a branch, only a slim '
    + 'marker that the chat used a connector', () => {
    const branched = stripToolPartsFromBranchedMessage(connectorParts)

    expect(branched).toEqual([
      { type: 'text', text: 'Here are your issues' },
      {
        type: 'data-connectors-notice',
        data: { lines: [], usedConnector: true },
      },
    ])
    expect(JSON.stringify(branched)).not.toContain('customer')
    expect(JSON.stringify(branched)).not.toContain('Linear')
    expect(JSON.stringify(branched)).not.toContain('linear')
  })

  it('keeps one marker when a branch is branched again', () => {
    const once = stripToolPartsFromBranchedMessage(connectorParts)

    expect(stripToolPartsFromBranchedMessage(once)).toEqual(once)
  })

  it('adds no marker to a message without connector calls', () => {
    expect(stripToolPartsFromBranchedMessage([
      { type: 'text', text: 'Plain answer' },
      { type: 'data-connectors-notice', data: { lines: ['A notice'] } },
    ] as unknown as UIMessage['parts'])).toEqual([
      { type: 'text', text: 'Plain answer' },
    ])
  })

  it('drops the marker from a public share', () => {
    const [message] = filterPublicParts([{
      id: 'm1',
      parts: stripToolPartsFromBranchedMessage(connectorParts),
    }])

    expect(message!.parts).toEqual([
      { type: 'text', text: 'Here are your issues' },
    ])
  })
})

describe('approval parts in shares and branches', () => {
  const approvalParts = [
    { type: 'step-start' },
    {
      type: 'dynamic-tool',
      toolName: 'mcp__linear__create_issue',
      toolCallId: 'call-1',
      state: 'approval-requested',
      input: { title: 'x' },
      approval: { id: 'approval-0001' },
    },
    {
      type: 'data-tool-approval',
      id: 'call-1',
      data: {
        approvalId: 'approval-0001',
        toolCallId: 'call-1',
        toolName: 'mcp__linear__create_issue',
        reason: 'always-ask',
        summary: 'Linear wants to run mcp__linear__create_issue',
        rememberOptions: ['once'],
      },
    },
  ] as UIMessage['parts']

  it('leaves an approval-only message out of a public share', () => {
    const messages = filterPublicParts([
      { role: 'user', parts: [{ type: 'text', text: 'Do it' }] },
      { role: 'assistant', parts: approvalParts },
    ] as Array<{ role: string, parts: UIMessage['parts'] }>)

    expect(messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'Do it' }] },
    ])
  })

  it('keeps the text of a message that also waited for an approval', () => {
    const [message] = filterPublicParts([{
      parts: [...approvalParts, { type: 'text', text: 'Waiting on you.' }],
    }] as Array<{ parts: UIMessage['parts'] }>)

    expect(message?.parts).toEqual([
      { type: 'step-start' },
      { type: 'text', text: 'Waiting on you.' },
    ])
  })

  it('strips approval parts from a branch, with no connector marker', () => {
    expect(stripToolPartsFromBranchedMessage(approvalParts)).toEqual([
      { type: 'step-start' },
    ])
    expect(isApprovalOnlyMessage(approvalParts)).toBe(true)
    expect(isApprovalOnlyMessage([
      ...approvalParts,
      { type: 'text', text: 'Waiting on you.' },
    ])).toBe(false)
    expect(isApprovalOnlyMessage([{ type: 'step-start' }])).toBe(false)
  })
})
