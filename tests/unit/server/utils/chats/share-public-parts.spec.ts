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
  it('leaves the messages of a built-in command out whole', () => {
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'note' },
          { type: 'data-command-invocation', data: { command: 'stats' } },
        ],
      },
      {
        role: 'assistant',
        parts: [
          { type: 'data-command-report', data: { command: 'stats' } },
          { type: 'text', text: '```text\nSPEND\n```' },
        ],
      },
    ] as unknown as Array<{ role: string, parts: UIMessage['parts'] }>

    expect(filterPublicParts(messages)).toEqual([messages[0]])
  })

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

  it('drops a project skill activation too, so a pinned skill name never reaches a share', () => {
    const parts = [
      { type: 'text', text: 'Answer' },
      {
        type: 'data-skill-activation',
        data: {
          skillId: 'skl1',
          name: 'pinned-skill-name',
          version: 1,
          source: 'project',
        },
      },
    ] as unknown as UIMessage['parts']

    const [message] = filterPublicParts([{ id: 'm1', parts }])

    expect(message?.parts.map(part => part.type)).toEqual(['text'])
    expect(JSON.stringify(message)).not.toContain('pinned-skill-name')
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

  it('drops the Google tools withheld part from a branched message', () => {
    const branched = stripToolPartsFromBranchedMessage([
      {
        type: 'data-google-tools-withheld',
        data: { reason: 'model_may_not_receive_google_data' },
      },
      { type: 'text', text: 'Plain answer' },
    ] as unknown as UIMessage['parts'])

    expect(branched).toEqual([{ type: 'text', text: 'Plain answer' }])
    expect(JSON.stringify(branched)).not.toContain('google-tools-withheld')
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

describe('grant marker parts in shares and branches', () => {
  const grantedParts = [
    { type: 'step-start' },
    {
      type: 'dynamic-tool',
      toolName: 'mcp__linear__create_issue',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { title: 'x' },
      output: 'Created WEB-42',
    },
    {
      type: 'data-tool-grant',
      id: 'grant-call-1',
      data: {
        toolCallId: 'call-1',
        toolName: 'mcp__linear__create_issue',
        scope: 'always',
      },
    },
    { type: 'text', text: 'Filed WEB-42.' },
  ] as UIMessage['parts']

  it('leaves the grant part out of a public share', () => {
    const [message] = filterPublicParts([{ parts: grantedParts }] as Array<{
      parts: UIMessage['parts']
    }>)

    expect(message?.parts).toEqual([
      { type: 'step-start' },
      { type: 'text', text: 'Filed WEB-42.' },
    ])
  })

  it('leaves the grant part out of a branch', () => {
    expect(stripToolPartsFromBranchedMessage(grantedParts).some((part) => {
      return part.type === 'data-tool-grant'
    })).toBe(false)
  })
})

describe('connector image parts in shares and branches', () => {
  const imageParts = [
    { type: 'step-start' },
    {
      type: 'dynamic-tool',
      toolName: 'mcp__doop__get_frame_screenshot',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { frameId: 'f1' },
      output: '[image/png, 75 B: shown to the model, kept with this chat]',
    },
    {
      type: 'data-connector-image',
      id: 'connector-image-call-1-0',
      data: {
        toolCallId: 'call-1',
        fileId: 'file-1',
        url: '/files/connector-abc.png',
        mediaType: 'image/png',
        width: 8,
        height: 8,
        size: 75,
        name: 'doop-get_frame_screenshot.png',
      },
    },
    { type: 'text', text: 'The frame looks right.' },
  ] as UIMessage['parts']

  it('leaves the connector image out of a public share', () => {
    const [message] = filterPublicParts([{ parts: imageParts }] as Array<{
      parts: UIMessage['parts']
    }>)

    expect(message?.parts).toEqual([
      { type: 'step-start' },
      { type: 'text', text: 'The frame looks right.' },
    ])
    expect(JSON.stringify(message)).not.toContain('connector-abc.png')
  })

  it('leaves the connector image out of a branch with its step', () => {
    const branched = stripToolPartsFromBranchedMessage(imageParts)

    expect(branched.some((part) => {
      return part.type === 'data-connector-image'
        || part.type === 'dynamic-tool'
    })).toBe(false)
  })

  it('shows a Google Drive file by its name only in a public share', () => {
    const [message] = filterPublicParts([{
      role: 'user',
      parts: [
        { type: 'text', text: 'Summarize this' },
        {
          type: 'file',
          mediaType: 'text/markdown',
          filename: 'Plan.md',
          url: '/files/abc.md',
        },
        {
          type: 'data-drive-file',
          data: {
            driveFileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
            name: 'Plan',
            mimeType: 'text/markdown',
            link: 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz',
          },
        },
      ],
    }] as unknown as Array<{ role: string, parts: UIMessage['parts'] }>)
    const reference = message!.parts.find((part) => {
      return part.type === 'data-drive-file'
    }) as unknown as { data: Record<string, string> }

    expect(reference.data).toEqual({
      driveFileId: '',
      name: 'Plan',
      mimeType: '',
      link: '',
    })
    expect(JSON.stringify(message)).not.toContain('drive.google.com')
    expect(JSON.stringify(message)).not.toContain('1AbCdEfGhIjKlMnOpQrStUvWxYz')
  })

  it('drops the Google tools withheld note from a share and a branch',
    () => {
      const message = {
        id: 'assistant-withheld',
        role: 'assistant',
        parts: [
          {
            type: 'data-google-tools-withheld',
            data: { reason: 'model_may_not_receive_google_data' },
          },
          { type: 'text', text: 'I have no calendar access.' },
        ],
      } as unknown as UIMessage

      expect(filterPublicParts([message])[0]!.parts).toEqual([
        { type: 'text', text: 'I have no calendar access.' },
      ])
      expect(stripToolPartsFromBranchedMessage(message.parts)).toEqual([
        { type: 'text', text: 'I have no calendar access.' },
      ])
    })

  it('drops the tool part of a created Google file, body included', () => {
    const createdFile = {
      type: 'tool-google__drive_create_file',
      toolCallId: 'call_1',
      state: 'output-available',
      input: { name: 'Plan', kind: 'document', content: '# Secret body' },
      output: {
        references: [{
          id: 'abcdefghij1234567890',
          kind: 'file',
          title: 'Plan',
        }],
      },
    }
    const [message] = filterPublicParts([{
      parts: [{ type: 'text', text: 'Made it.' }, createdFile],
    }] as unknown as Array<{ parts: UIMessage['parts'] }>)

    expect(message?.parts).toEqual([{ type: 'text', text: 'Made it.' }])
    expect(JSON.stringify(message)).not.toContain('Secret body')
    expect(JSON.stringify(message)).not.toContain('abcdefghij1234567890')
  })

  it('drops the stopped marker from a share and keeps it in a branch',
    () => {
      const stoppedReply = {
        id: 'assistant-stopped',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Half an answ' },
          { type: 'data-reply-stopped', data: { stoppedAt: 'x' } },
        ],
      } as unknown as UIMessage

      expect(filterPublicParts([stoppedReply])[0]!.parts).toEqual([
        { type: 'text', text: 'Half an answ' },
      ])
      expect(stripToolPartsFromBranchedMessage(stoppedReply.parts)
        .map(part => (part as { type: string }).type))
        .toContain('data-reply-stopped')
    })
})
