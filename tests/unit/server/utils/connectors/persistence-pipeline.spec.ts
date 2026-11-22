import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  CONNECTOR_CALLS_PER_TURN,
  CONNECTOR_RESULT_MAX_BYTES,
} from '#shared/utils/connectors-policy'
import {
  normalizeAssistantMessagePartsForPersistence,
  stripUndeliveredInlineDataParts,
} from '~~/server/utils/files/assistant-files'
import { redactConnectorToolPartsForPersistence } from '~~/server/utils/connectors/persist'
import { frameUntrustedResult } from '~~/server/utils/connectors/tool-definitions'

function connectorPart(index: number, output: string) {
  return {
    type: 'dynamic-tool',
    toolName: 'mcp__linear__list_issues',
    toolCallId: `call-${index}`,
    state: 'output-available',
    input: { page: index },
    output,
  }
}

async function persistPipeline(parts: unknown[], secrets: string[] = []) {
  const logger = { set: vi.fn() }
  const normalized = await normalizeAssistantMessagePartsForPersistence({
    parts: parts as UIMessage['parts'],
    providerId: 'openai',
    chatId: 'chat-1',
    userId: 1,
    logger,
  })

  return stripUndeliveredInlineDataParts(
    redactConnectorToolPartsForPersistence(normalized, secrets),
    logger,
  )
}

describe('connector parts through the real persistence pipeline', () => {
  it('keeps a connector call next to the answer text, redacted', async () => {
    const framed = frameUntrustedResult({
      slug: 'linear',
      toolName: 'list_issues',
      text: 'Issue BES-1 token-secret-1234',
    }).text
    const persisted = await persistPipeline([
      connectorPart(1, framed),
      { type: 'text', text: 'You have one issue.' },
    ], ['token-secret-1234'])

    expect(persisted).toHaveLength(2)
    expect(persisted[0]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'mcp__linear__list_issues',
      state: 'output-available',
    })
    expect(JSON.stringify(persisted)).not.toContain('token-secret-1234')
    expect(persisted[1]).toEqual({
      type: 'text',
      text: 'You have one issue.',
    })
  })

  it('does not trigger the whole-message oversize replacement for twelve '
    + 'results of the maximum size', async () => {
    const bigOutput = frameUntrustedResult({
      slug: 'linear',
      toolName: 'list_issues',
      text: 'line\n'.repeat(CONNECTOR_RESULT_MAX_BYTES),
    }).text
    const parts = Array.from(
      { length: CONNECTOR_CALLS_PER_TURN },
      (_unused, index) => connectorPart(index, bigOutput),
    )
    const persisted = await persistPipeline([
      ...parts,
      { type: 'text', text: 'Summary.' },
    ])

    expect(persisted.filter(part => part.type === 'dynamic-tool'))
      .toHaveLength(CONNECTOR_CALLS_PER_TURN)
    expect(persisted.at(-1)).toEqual({ type: 'text', text: 'Summary.' })
  })

  it('keeps the kept-image part of a connector call unchanged', async () => {
    const imagePart = {
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
        name: 'linear-list_issues.png',
      },
    }
    const persisted = await persistPipeline([
      connectorPart(1, frameUntrustedResult({
        slug: 'linear',
        toolName: 'list_issues',
        text: '[image/png, 75 B: shown to the model, kept with this chat]',
      }).text),
      imagePart,
      { type: 'text', text: 'It is red.' },
    ])

    expect(persisted).toHaveLength(3)
    expect(persisted[1]).toEqual(imagePart)
  })
})
