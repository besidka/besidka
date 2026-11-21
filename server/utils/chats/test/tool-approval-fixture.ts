import type { UIMessage } from 'ai'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import { TOOL_APPROVAL_DATA_PART_TYPE } from '#shared/utils/tool-approval-parts'

export const TEST_TOOL_APPROVAL_PROMPT
  = 'File a Linear issue for the login bug and remember that I use Safari.'

const CONNECTOR_CALL_ID = 'test-approval-call-1'
const MEMORY_CALL_ID = 'test-approval-call-2'

function connectorCallParts(): UIMessage['parts'] {
  return [
    {
      type: 'dynamic-tool',
      toolName: 'mcp__linear__create_issue',
      toolCallId: CONNECTOR_CALL_ID,
      state: 'approval-requested',
      input: {
        team: 'Web',
        title: 'Login fails on Safari 26',
        description: 'Users on Safari 26 see a blank page after signing in.',
        labels: ['bug', 'auth'],
      },
      approval: { id: 'test-approval-0001' },
    },
    {
      type: TOOL_APPROVAL_DATA_PART_TYPE,
      id: CONNECTOR_CALL_ID,
      data: {
        approvalId: 'test-approval-0001',
        toolCallId: CONNECTOR_CALL_ID,
        toolName: 'mcp__linear__create_issue',
        reason: 'default',
        summary: 'linear wants to run mcp__linear__create_issue',
        rememberOptions: ['once', 'chat', 'always'],
      },
    },
  ] as unknown as UIMessage['parts']
}

function memoryCallParts(): UIMessage['parts'] {
  return [
    {
      type: 'tool-memory_write',
      toolCallId: MEMORY_CALL_ID,
      state: 'approval-requested',
      input: { content: 'Uses Safari as the main browser.' },
      approval: { id: 'test-approval-0002' },
    },
    {
      type: TOOL_APPROVAL_DATA_PART_TYPE,
      id: MEMORY_CALL_ID,
      data: {
        approvalId: 'test-approval-0002',
        toolCallId: MEMORY_CALL_ID,
        toolName: 'memory_write',
        reason: 'untrusted-output',
        summary: 'Besidka wants to save a memory',
        rememberOptions: ['once'],
      },
    },
  ] as unknown as UIMessage['parts']
}

export const TEST_BESIDKA_TOOL_APPROVAL_PROMPT
  = 'Clean up: delete my old draft chats.'

const BESIDKA_READ_CALL_ID = 'test-besidka-call-1'
const BESIDKA_DELETE_CALL_ID = 'test-besidka-call-2'
const BESIDKA_DRAFT_SLUGS = [
  '01HZXAAAAAAAAAAAAAAAAAAAAA',
  '01HZXBBBBBBBBBBBBBBBBBBBBB',
]

function besidkaCallParts(): UIMessage['parts'] {
  return [
    { type: 'step-start' },
    {
      type: 'tool-besidka__list_projects',
      toolCallId: BESIDKA_READ_CALL_ID,
      state: 'output-available',
      input: {},
      output: '<untrusted_tool_result connector="besidka" '
        + 'tool="list_projects">\n{"projects":[]}\n</untrusted_tool_result>',
    },
    {
      type: 'data-tool-grant',
      id: `grant-${BESIDKA_READ_CALL_ID}`,
      data: {
        toolCallId: BESIDKA_READ_CALL_ID,
        toolName: 'besidka__list_projects',
        scope: 'always',
      },
    },
    { type: 'step-start' },
    {
      type: 'tool-besidka__delete_chats',
      toolCallId: BESIDKA_DELETE_CALL_ID,
      state: 'approval-requested',
      input: { slugs: BESIDKA_DRAFT_SLUGS },
      approval: { id: 'test-besidka-approval-0001' },
    },
    {
      type: TOOL_APPROVAL_DATA_PART_TYPE,
      id: BESIDKA_DELETE_CALL_ID,
      data: {
        approvalId: 'test-besidka-approval-0001',
        toolCallId: BESIDKA_DELETE_CALL_ID,
        toolName: 'besidka__delete_chats',
        reason: 'always-ask',
        summary: `Delete 2 chats: ${BESIDKA_DRAFT_SLUGS.join(', ')}`,
        rememberOptions: ['once', 'chat', 'always'],
      },
    },
  ] as unknown as UIMessage['parts']
}

/**
 * The `besidka-tool-approval` test chat: a Besidka read that ran under
 * Always allow, then a Besidka delete waiting for an answer (every
 * remember option since the owner decision of 2026-11-20).
 */
export function buildTestBesidkaToolApprovalMessages(scenarioKey: string) {
  return [
    {
      id: `test-chat-${scenarioKey}-message-1`,
      role: 'user' as const,
      parts: [{ type: 'text', text: TEST_BESIDKA_TOOL_APPROVAL_PROMPT }],
      tools: [],
      reasoning: 'off' as ReasoningLevel,
    },
    {
      id: `test-chat-${scenarioKey}-message-2`,
      role: 'assistant' as const,
      parts: besidkaCallParts(),
      tools: [],
      reasoning: 'off' as ReasoningLevel,
    },
  ]
}

/**
 * The messages of the `tool-approval` (one waiting connector call) and
 * `tool-approvals` (a connector call and a memory write after a web
 * source) test chats: a user prompt and a reply paused for approval.
 */
export function buildTestToolApprovalMessages(
  scenarioKey: string,
  callCount: 1 | 2,
) {
  const assistantParts: UIMessage['parts'] = [
    { type: 'step-start' },
    ...connectorCallParts(),
    ...(callCount === 2
      ? [
        {
          type: 'source-url',
          sourceId: 'test-approval-source-1',
          url: 'https://example.com/safari-26-release-notes',
          title: 'Safari 26 release notes',
        },
        ...memoryCallParts(),
      ] as UIMessage['parts']
      : []),
  ]

  return [
    {
      id: `test-chat-${scenarioKey}-message-1`,
      role: 'user' as const,
      parts: [{ type: 'text', text: TEST_TOOL_APPROVAL_PROMPT }],
      tools: [],
      reasoning: 'off' as ReasoningLevel,
    },
    {
      id: `test-chat-${scenarioKey}-message-2`,
      role: 'assistant' as const,
      parts: assistantParts,
      tools: [],
      reasoning: 'off' as ReasoningLevel,
    },
  ]
}
