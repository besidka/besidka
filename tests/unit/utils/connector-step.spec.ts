import { describe, expect, it } from 'vitest'
import type { ConnectorToolCallModel } from '#shared/utils/connectors-parts'
import {
  formatConnectorArguments,
  getConnectorStepTitle,
  isConnectorStepFailed,
} from '~/utils/connector-step'

function createCall(
  overrides: Partial<ConnectorToolCallModel> = {},
): ConnectorToolCallModel {
  return {
    slug: 'notion',
    tool: 'search',
    isRunning: false,
    outcome: 'ok',
    isFramed: true,
    input: {},
    ...overrides,
  }
}

describe('getConnectorStepTitle', () => {
  it('names the connector and the tool for every state', () => {
    expect(getConnectorStepTitle(
      createCall({ isRunning: true, outcome: null }),
      'Notion',
    )).toBe('Using Notion · search')
    expect(getConnectorStepTitle(createCall(), 'Notion'))
      .toBe('Used Notion · search')
    expect(getConnectorStepTitle(createCall({ outcome: 'error' }), 'Notion'))
      .toBe('Could not use Notion · search')
    expect(getConnectorStepTitle(createCall({ outcome: 'denied' }), 'Notion'))
      .toBe('Needs approval: Notion · search')
  })

  it('falls back to the slug for a deleted connector', () => {
    expect(getConnectorStepTitle(createCall(), undefined))
      .toBe('Used notion · search')
  })
})

describe('isConnectorStepFailed', () => {
  it('flags errors and denials only', () => {
    expect(isConnectorStepFailed(createCall({ outcome: 'error' }))).toBe(true)
    expect(isConnectorStepFailed(createCall({ outcome: 'denied' }))).toBe(true)
    expect(isConnectorStepFailed(createCall())).toBe(false)
    expect(isConnectorStepFailed(createCall({ outcome: null }))).toBe(false)
  })
})

describe('formatConnectorArguments', () => {
  it('pretty prints the input as text', () => {
    expect(formatConnectorArguments({ query: 'roadmap' }))
      .toBe('{\n  "query": "roadmap"\n}')
  })

  it('returns an empty string when there are no arguments', () => {
    expect(formatConnectorArguments(undefined)).toBe('')
    expect(formatConnectorArguments(null)).toBe('')
    expect(formatConnectorArguments({})).toBe('')
  })

  it('truncates very long input', () => {
    const text = formatConnectorArguments({ query: 'x'.repeat(10000) })

    expect(text.length).toBeLessThan(4100)
    expect(text.endsWith('…')).toBe(true)
  })
})
