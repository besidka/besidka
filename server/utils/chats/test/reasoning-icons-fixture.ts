import type { UIMessage } from 'ai'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { MessageUsage } from '#shared/types/message-usage.d'

export const TEST_REASONING_ICONS_PROMPT
  = 'Research the Safari 26 release, write it up and file it in Linear.'

export const TEST_REASONING_ICONS_REPLY
  = 'Done. The summary is filed in Linear.'

const TEST_REASONING_ICONS_USAGE: MessageUsage = {
  model: 'claude-test',
  provider: 'anthropic',
  inputTokens: 1200,
  outputTokens: 300,
  totalTokens: 1500,
  searchUnits: 1,
  searchBillingUnit: 'search',
  searchProvider: 'anthropic',
}

function toolPart(
  type: string,
  toolCallId: string,
  input: unknown,
  output: unknown,
) {
  return {
    type,
    toolCallId,
    state: 'output-available',
    input,
    output,
  }
}

function buildParts(): UIMessage['parts'] {
  return [
    { type: 'step-start' },
    toolPart('tool-web_search_brave', 'icons-1', { query: 'Safari 26' }, {
      results: [{
        title: 'Safari 26 release notes',
        url: 'https://example.com/safari-26',
      }],
    }),
    toolPart('tool-web_search_exa', 'icons-2', { query: 'Safari 26 PWA' }, {
      results: [],
    }),
    toolPart('tool-web_search_preview', 'icons-3', {}, {}),
    toolPart('tool-activate_skill', 'icons-4', { name: 'Release notes' }, {
      skillId: 'test-skill',
      name: 'Release notes',
    }),
    toolPart('tool-memory_list', 'icons-5', {}, { entries: [] }),
    toolPart('tool-create_document', 'icons-6', { format: 'docx' }, {}),
    toolPart('tool-create_document', 'icons-7', { format: 'xlsx' }, {}),
    toolPart('tool-create_document', 'icons-8', { format: 'pptx' }, {}),
    toolPart('tool-create_document', 'icons-9', { format: 'pdf' }, {}),
    {
      type: 'dynamic-tool',
      toolName: 'mcp__sentry__search_issues',
      toolCallId: 'icons-10',
      state: 'output-available',
      input: { query: 'Safari' },
      output: 'ok',
    },
    {
      type: 'dynamic-tool',
      toolName: 'mcp__vercel__list_projects',
      toolCallId: 'icons-11',
      state: 'output-available',
      input: {},
      output: 'ok',
    },
    {
      type: 'dynamic-tool',
      toolName: 'mcp__linear__create_issue',
      toolCallId: 'icons-12',
      state: 'output-available',
      input: { title: 'Login fails' },
      output: 'ok',
    },
    { type: 'text', text: TEST_REASONING_ICONS_REPLY },
  ] as unknown as UIMessage['parts']
}

/**
 * The messages of the `reasoning-icons` test chat: one reply whose reasoning
 * steps cover every kind of step icon (search vendors, a skill, memory, the
 * four document types and three connectors).
 */
export function buildTestReasoningIconsMessages(scenarioKey: string) {
  return [
    {
      id: `test-chat-${scenarioKey}-message-1`,
      role: 'user' as const,
      parts: [{ type: 'text', text: TEST_REASONING_ICONS_PROMPT }],
      tools: [],
      reasoning: 'off' as ReasoningLevel,
    },
    {
      id: `test-chat-${scenarioKey}-message-2`,
      role: 'assistant' as const,
      parts: buildParts(),
      tools: [],
      reasoning: 'off' as ReasoningLevel,
      usage: TEST_REASONING_ICONS_USAGE,
      createdAt: new Date().toISOString(),
    },
  ]
}
