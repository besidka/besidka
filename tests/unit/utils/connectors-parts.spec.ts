import { describe, expect, it } from 'vitest'
import {
  buildConnectorUsedMarkerPart,
  CONNECTOR_APPROVAL_DENIAL_TEXT,
  CONNECTOR_CROSS_CONNECTOR_DENIAL_TEXT,
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
    expect(getConnectorToolCall({ type: 'tool-mcp__a__b' })).toBeNull()
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

  it('reads a denial from the output sentence even though the state succeeded', () => {
    expect(getConnectorToolCall(createPart({
      output: CONNECTOR_APPROVAL_DENIAL_TEXT,
    }))).toMatchObject({ outcome: 'denied', isFramed: false })
  })
})

describe('the cross-connector refusal', () => {
  it('reads as a denial like the approval sentence', () => {
    expect(getConnectorToolCall(createPart({
      output: CONNECTOR_CROSS_CONNECTOR_DENIAL_TEXT,
    }))).toMatchObject({ outcome: 'denied', isFramed: false })
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
