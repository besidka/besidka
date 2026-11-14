import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { sanitizeMessagesForModelContext } from '~~/server/utils/files/assistant-files'
import { extractMessageSearchText } from '~~/server/utils/search/text'

const connectorPart = {
  type: 'dynamic-tool',
  toolName: 'mcp__linear__list_issues',
  toolCallId: 'call-1',
  state: 'output-available',
  input: { query: 'x' },
  output: '<untrusted_tool_result connector="linear" tool="list_issues">'
    + '\nCONNECTOR-RESULT-BODY\n</untrusted_tool_result>',
}

describe('connector results stay out of later context', () => {
  it('drops the call and its result from the next model context', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'list' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [connectorPart, { type: 'text', text: 'Here you go' }],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'thanks' }] },
    ] as unknown as UIMessage[]
    const context = sanitizeMessagesForModelContext(messages)

    expect(JSON.stringify(context)).not.toContain('CONNECTOR-RESULT-BODY')
    expect(JSON.stringify(context)).not.toContain('mcp__linear')
    expect(context.find(message => message.id === 'a1')?.parts).toEqual([
      { type: 'text', text: 'Here you go' },
    ])
  })

  it('drops the used-connector marker from the next model context', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'list' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Here you go' },
          {
            type: 'data-connectors-notice',
            data: { lines: [], usedConnector: true },
          },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'thanks' }] },
    ] as unknown as UIMessage[]
    const context = sanitizeMessagesForModelContext(messages)

    expect(context.find(message => message.id === 'a1')?.parts).toEqual([
      { type: 'text', text: 'Here you go' },
    ])
  })

  it('never indexes the result for chat search', () => {
    expect(extractMessageSearchText([
      connectorPart,
      { type: 'text', text: 'Here you go' },
    ])).not.toContain('CONNECTOR-RESULT-BODY')
  })
})
