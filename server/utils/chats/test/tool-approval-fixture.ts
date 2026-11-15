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
