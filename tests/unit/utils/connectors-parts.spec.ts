import { describe, expect, it } from 'vitest'
import { buildConnectorCallErrorText } from '#shared/utils/connectors-errors'
import {
  buildConnectorUsedMarkerPart,
  CONNECTOR_APPROVAL_DENIAL_TEXT,
  CONNECTOR_CALL_LIMIT_TEXT,
  CONNECTOR_CROSS_CONNECTOR_DENIAL_TEXT,
  CONNECTOR_RATE_LIMIT_TEXT,
  CONNECTOR_UNAPPROVED_CALL_TEXT,
  getConnectorNoticeLines,
  getConnectorToolCall,
  isConnectorUsagePart,
  isConnectorUsedMarker,
  isFramedConnectorOutput,
  parseConnectorToolName,
} from '#shared/utils/connectors-parts'

const framed = '<untrusted_tool_result connector="notion" tool="search">'
  + 'result</untrusted_tool_result>'

function createPart(overrides: Record<string, unknown> = {}) {
  return {
    type: 'dynamic-tool',
    toolName: 'mcp__notion__search',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { query: 'roadmap' },
    output: framed,
    ...overrides,
  }
}

describe('parseConnectorToolName', () => {
  it('splits the slug at the first double underscore', () => {
    expect(parseConnectorToolName('mcp__notion__search'))
      .toEqual({ slug: 'notion', tool: 'search' })
    expect(parseConnectorToolName('mcp__my-crm__create_contact__v2'))
      .toEqual({ slug: 'my-crm', tool: 'create_contact__v2' })
  })

  it('rejects names that are not connector tools', () => {
    expect(parseConnectorToolName('web_search')).toBeNull()
    expect(parseConnectorToolName('mcp__notion')).toBeNull()
    expect(parseConnectorToolName('mcp____search')).toBeNull()
    expect(parseConnectorToolName('mcp__notion__')).toBeNull()
  })
})

describe('isFramedConnectorOutput', () => {
  it('recognizes only the untrusted result frame', () => {
    expect(isFramedConnectorOutput(framed)).toBe(true)
    expect(isFramedConnectorOutput(`\n  ${framed}`)).toBe(true)
    expect(isFramedConnectorOutput(CONNECTOR_APPROVAL_DENIAL_TEXT)).toBe(false)
    expect(isFramedConnectorOutput({ text: framed })).toBe(false)
    expect(isFramedConnectorOutput(undefined)).toBe(false)
  })
})

describe('getConnectorToolCall', () => {
  it('returns null for parts that are not connector calls', () => {
    expect(getConnectorToolCall(null)).toBeNull()
    expect(getConnectorToolCall({ type: 'text', text: 'hi' })).toBeNull()
    expect(getConnectorToolCall({ type: 'tool-mcp__a' })).toBeNull()
    expect(getConnectorToolCall({ type: 'tool-other__a__b' })).toBeNull()
    expect(getConnectorToolCall(createPart({ toolName: 'other' }))).toBeNull()
  })

  it('models a running call without an outcome', () => {
    for (const state of ['input-streaming', 'input-available']) {
      expect(getConnectorToolCall(createPart({ state, output: undefined })))
        .toMatchObject({
          slug: 'notion',
          tool: 'search',
          isRunning: true,
          outcome: null,
          isFramed: false,
        })
    }
  })

  it('models a framed result as ok and untrusted', () => {
    expect(getConnectorToolCall(createPart())).toMatchObject({
      isRunning: false,
      outcome: 'ok',
      isFramed: true,
      input: { query: 'roadmap' },
    })
  })

  it('models an errored call as an error', () => {
    expect(getConnectorToolCall(createPart({
      state: 'output-error',
      output: undefined,
      errorText: 'Timed out',
    }))).toMatchObject({ outcome: 'error', isFramed: false })
  })

  it('reads the category and reference of a failed call', () => {
    const errorText = buildConnectorCallErrorText('auth', '7KQ2-M9XD')

    expect(getConnectorToolCall(createPart({
      state: 'output-error',
      output: undefined,
      errorText,
    }))?.error).toMatchObject({
      category: 'auth',
      reference: '7KQ2-M9XD',
      reason: 'the service rejected the credentials',
    })
    expect(getConnectorToolCall(createPart({
      state: 'output-error',
      output: undefined,
      errorText: JSON.stringify({ message: errorText }),
    }))?.error).toMatchObject({ category: 'auth' })
  })

  it('has no error line for the legacy fixed text or a successful call', () => {
    expect(getConnectorToolCall(createPart({
      state: 'output-error',
      output: undefined,
      errorText: 'The connector tool call failed.',
    }))?.error).toBeNull()
    expect(getConnectorToolCall(createPart())?.error).toBeNull()
  })

  it('models a static tool-<name> part like a dynamic one', () => {
    expect(getConnectorToolCall({
      type: 'tool-mcp__doop__list_canvases',
      toolCallId: 'call-2',
      state: 'output-error',
      input: {},
      errorText: buildConnectorCallErrorText('timeout', '7KQ2-M9XD'),
    })).toMatchObject({
      slug: 'doop',
      tool: 'list_canvases',
      outcome: 'error',
      error: { category: 'timeout' },
    })
    expect(getConnectorToolCall({
      type: 'tool-web_search',
      state: 'output-error',
    })).toBeNull()
  })

  it('reads a denial from the output sentence even though the state succeeded', () => {
    expect(getConnectorToolCall(createPart({
      output: CONNECTOR_APPROVAL_DENIAL_TEXT,
    }))).toMatchObject({ outcome: 'denied', isFramed: false })
  })
})

describe('a connector call that waits for approval', () => {
  it('has no outcome yet and does not count as connector usage', () => {
    const part = createPart({
      state: 'approval-requested',
      output: undefined,
      approval: { id: 'approval-0001' },
    })

    expect(getConnectorToolCall(part)).toMatchObject({
      isRunning: false,
      isAwaitingApproval: true,
      outcome: null,
    })
    expect(isConnectorUsagePart(part)).toBe(false)
    expect(isConnectorUsagePart(createPart())).toBe(true)
  })

  it('reads the unapproved-call refusal as a denial', () => {
    expect(getConnectorToolCall(createPart({
      output: CONNECTOR_UNAPPROVED_CALL_TEXT,
    }))?.outcome).toBe('denied')
  })
})

describe('the cross-connector refusal', () => {
  it('reads as a denial like the approval sentence', () => {
    expect(getConnectorToolCall(createPart({
      output: CONNECTOR_CROSS_CONNECTOR_DENIAL_TEXT,
    }))).toMatchObject({ outcome: 'denied', isFramed: false })
  })
})

describe('the limit refusals', () => {
  it('read as limited, not as ok and not as a denial', () => {
    expect(getConnectorToolCall(createPart({
      output: CONNECTOR_CALL_LIMIT_TEXT,
    }))).toMatchObject({ outcome: 'limited', isFramed: false })
    expect(getConnectorToolCall(createPart({
      output: CONNECTOR_RATE_LIMIT_TEXT,
    }))).toMatchObject({ outcome: 'limited', isFramed: false })
  })

  it('keep a real framed result ok', () => {
    expect(getConnectorToolCall(createPart()))
      .toMatchObject({ outcome: 'ok' })
  })
})

describe('the used-connector marker', () => {
  it('is recognized as usage but is no call and has no notice lines', () => {
    const marker = buildConnectorUsedMarkerPart()

    expect(isConnectorUsedMarker(marker)).toBe(true)
    expect(isConnectorUsagePart(marker)).toBe(true)
    expect(getConnectorToolCall(marker)).toBeNull()
    expect(getConnectorNoticeLines({ parts: [marker] })).toEqual([])
  })

  it('counts a connector call as usage and nothing else', () => {
    expect(isConnectorUsagePart(createPart())).toBe(true)
    expect(isConnectorUsagePart({ type: 'text', text: 'x' })).toBe(false)
    expect(isConnectorUsagePart({
      type: 'data-connectors-notice',
      data: { lines: ['x'] },
    })).toBe(false)
    expect(isConnectorUsedMarker(null)).toBe(false)
  })
})

describe('getConnectorNoticeLines', () => {
  it('collects trimmed, unique lines from the notice parts', () => {
    expect(getConnectorNoticeLines({
      parts: [
        { type: 'text', text: 'hi' },
        {
          type: 'data-connectors-notice',
          data: { lines: [' Connectors are off for this message ', '', 3] },
        },
        {
          type: 'data-connectors-notice',
          data: { lines: ['Connectors are off for this message'] },
        },
        { type: 'data-connectors-notice', data: {} },
      ],
    })).toEqual(['Connectors are off for this message'])
  })
})
