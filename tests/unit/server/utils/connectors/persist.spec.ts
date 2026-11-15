import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { CONNECTOR_RESULT_MAX_BYTES } from '#shared/utils/connectors-policy'
import { redactConnectorToolPartsForPersistence } from '~~/server/utils/connectors/persist'

function dynamicPart(overrides: Record<string, unknown>) {
  return {
    type: 'dynamic-tool',
    toolName: 'mcp__linear__list_issues',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { query: 'hello' },
    output: 'ok',
    ...overrides,
  } as unknown as UIMessage['parts'][number]
}

describe('redactConnectorToolPartsForPersistence', () => {
  it('redacts credentials in the output and the input', () => {
    const [part] = redactConnectorToolPartsForPersistence([
      dynamicPart({
        input: { header: 'token-secret-1234', nested: ['token-secret-1234'] },
        output: 'echo token-secret-1234',
      }),
    ], ['token-secret-1234']) as Array<Record<string, any>>

    expect(JSON.stringify(part)).not.toContain('token-secret-1234')
    expect(part!.output).toBe('echo [redacted]')
  })

  it('cuts an oversized output to the result cap plus the frame', () => {
    const [part] = redactConnectorToolPartsForPersistence([
      dynamicPart({ output: 'y'.repeat(CONNECTOR_RESULT_MAX_BYTES * 3) }),
    ], []) as Array<Record<string, any>>

    expect(part!.output.length).toBeLessThanOrEqual(
      CONNECTOR_RESULT_MAX_BYTES + 1024,
    )
  })

  it('replaces an error text with a fixed sentence', () => {
    const [part] = redactConnectorToolPartsForPersistence([
      dynamicPart({
        state: 'output-error',
        errorText: 'upstream said https://x.test/?k=secret',
      }),
    ], []) as Array<Record<string, any>>

    expect(part!.errorText).toBe('The connector tool call failed.')
  })

  it('leaves every other part untouched and never mutates the input', () => {
    const other = { type: 'text', text: 'token-secret-1234' }
    const nonConnector = dynamicPart({ toolName: 'plain_tool' })
    const connector = dynamicPart({ output: 'token-secret-1234' })
    const input = [other, nonConnector, connector] as UIMessage['parts']
    const result = redactConnectorToolPartsForPersistence(
      input,
      ['token-secret-1234'],
    )

    expect(result[0]).toBe(other)
    expect(result[1]).toBe(nonConnector)
    expect((connector as { output: string }).output).toBe('token-secret-1234')
  })
})
