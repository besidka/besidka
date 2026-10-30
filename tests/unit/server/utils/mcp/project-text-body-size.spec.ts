import { describe, expect, it } from 'vitest'
import {
  MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES,
} from '~~/config/mcp-server'
import {
  MCP_KNOWLEDGE_BATCH_MAX_ITEMS,
  MCP_KNOWLEDGE_BATCH_TEXT_MAX_CHARS,
  MCP_KNOWLEDGE_TEXT_MAX_CHARS,
} from '~~/server/utils/mcp/private/projects'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'

const PROJECT_ID_CHARS = 32
const CYRILLIC_LINE
  = 'Робочі години за «вересень»: "Іваненко", "Петренко", 7,5\n'

function toCyrillicText(chars: number): string {
  return CYRILLIC_LINE.repeat(Math.ceil(chars / CYRILLIC_LINE.length))
    .slice(0, chars)
}

function toToolsCallBytes(argumentsValue: Record<string, unknown>): number {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 'call-1234567890',
    method: 'tools/call',
    params: { name: 'add_project_text', arguments: argumentsValue },
  })

  return new TextEncoder().encode(body).length
}

describe('add_project_text request body size', () => {
  it('fits one item of the single text limit in Cyrillic', () => {
    const bytes = toToolsCallBytes({
      projectId: 'p'.repeat(PROJECT_ID_CHARS),
      name: 'Ж'.repeat(KNOWLEDGE_LIMITS.maxTitleChars),
      text: toCyrillicText(MCP_KNOWLEDGE_TEXT_MAX_CHARS),
    })

    expect(bytes).toBeLessThanOrEqual(
      MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES,
    )
  })

  it('fits a full batch at the total character limit in Cyrillic', () => {
    const itemChars = Math.floor(
      MCP_KNOWLEDGE_BATCH_TEXT_MAX_CHARS / MCP_KNOWLEDGE_BATCH_MAX_ITEMS,
    )
    const items = Array.from(
      { length: MCP_KNOWLEDGE_BATCH_MAX_ITEMS },
      () => {
        return {
          name: 'Ж'.repeat(KNOWLEDGE_LIMITS.maxTitleChars),
          text: toCyrillicText(itemChars),
        }
      },
    )
    const bytes = toToolsCallBytes({
      projectId: 'p'.repeat(PROJECT_ID_CHARS),
      items,
    })

    expect(bytes).toBeLessThanOrEqual(
      MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES,
    )
  })

  it('still fits when every second character is a newline', () => {
    const text = 'ж\n'.repeat(MCP_KNOWLEDGE_BATCH_TEXT_MAX_CHARS / 2)
    const bytes = toToolsCallBytes({
      projectId: 'p'.repeat(PROJECT_ID_CHARS),
      items: [{ name: 'a'.repeat(KNOWLEDGE_LIMITS.maxTitleChars), text }],
    })

    expect(text.length).toBe(MCP_KNOWLEDGE_BATCH_TEXT_MAX_CHARS)
    expect(bytes).toBeLessThanOrEqual(
      MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES,
    )
  })

  it('still fits when every second character is a double quote', () => {
    const text = 'ж"'.repeat(MCP_KNOWLEDGE_BATCH_TEXT_MAX_CHARS / 2)
    const bytes = toToolsCallBytes({
      projectId: 'p'.repeat(PROJECT_ID_CHARS),
      items: [{ name: 'a'.repeat(KNOWLEDGE_LIMITS.maxTitleChars), text }],
    })

    expect(bytes).toBeLessThanOrEqual(
      MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES,
    )
  })

  it('leaves at least 100 KiB for the envelope and escaping', () => {
    const rawBytes = MCP_KNOWLEDGE_BATCH_TEXT_MAX_CHARS * 2

    expect(
      MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES - rawBytes,
    ).toBeGreaterThanOrEqual(100 * 1024)
  })
})
