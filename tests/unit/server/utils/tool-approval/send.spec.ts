import { describe, expect, it, vi } from 'vitest'
import type { UIMessageChunk } from 'ai'
import { TOOL_APPROVAL_DATA_PART_TYPE } from '#shared/utils/tool-approval-parts'
import {
  buildConnectorApprovalEntry,
  chatHasAwaitingApproval,
  classifyNativeTool,
  createSendToolApproval,
  createToolApprovalStreamCollector,
  presetApprovalTaint,
  recordToolApprovalPause,
} from '~~/server/utils/tool-approval/send'
import type { SendToolApproval } from '~~/server/utils/tool-approval/send'
import { createApprovalState } from '~~/server/utils/tool-approval/state'

const HASH = 'a'.repeat(64)
const SNAPSHOT = {
  model: 'claude-haiku-4-5',
  gateway: null,
  reasoning: 'off' as const,
  toolNames: ['create_artifact'],
  connectorIds: [],
}

function createKv() {
  const store = new Map<string, string>()

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
}

function connectorEntry(input: {
  connectorId: string
  slug: string
  tool: string
  readOnly: boolean
}) {
  return buildConnectorApprovalEntry({
    exposedName: `mcp__${input.slug}__${input.tool}`,
    connectorId: input.connectorId,
    connectorTitle: input.slug,
    connectorHost: `mcp.${input.slug}.example.com`,
    remoteToolName: input.tool,
    definitionHash: HASH,
    annotations: input.readOnly ? { readOnlyHint: true } : {},
  })
}

function createApproval(
  toolNames: string[],
  connectorEntries: Array<ReturnType<typeof connectorEntry>> = [],
): SendToolApproval {
  const approval = createSendToolApproval({ state: createApprovalState() })

  approval.registerTools(
    Object.fromEntries(toolNames.map(name => [name, {}])) as never,
    new Map(connectorEntries.map((entry) => {
      return [entry.descriptor.toolName, entry]
    })),
  )

  return approval
}

function call(toolCallId: string, toolName: string, input: unknown = {}) {
  return { toolCall: { toolCallId, toolName, input } }
}

describe('classifyNativeTool', () => {
  it('classifies writes, lookups and unknown tools', () => {
    expect(classifyNativeTool('memory_write')).toEqual({
      access: 'write',
      writesMemory: true,
      taint: null,
    })
    expect(classifyNativeTool('create_artifact').access).toBe('write')
    expect(classifyNativeTool('create_document').access).toBe('write')
    expect(classifyNativeTool('web_search_brave').taint).toBe('web')
    expect(classifyNativeTool('web_search_preview').taint).toBe('web')
    expect(classifyNativeTool('read_chat').taint).toBe('knowledge')
    expect(classifyNativeTool('activate_skill').taint).toBe('skill')
    expect(classifyNativeTool('memory_read')).toMatchObject({
      access: 'read',
      taint: null,
    })
    expect(classifyNativeTool('future_tool').access).toBe('write')
    expect(classifyNativeTool('code_execution', { type: 'provider' }).access)
      .toBe('read')
  })
})

describe('createSendToolApproval', () => {
  it('asks before a memory write once the send requested web search', () => {
    const approval = createApproval(['memory_write', 'web_search'])

    presetApprovalTaint(approval.state, {
      requestedTools: ['web_search'],
      holdsUntrustedKnowledge: false,
      holdsArtifactContext: false,
      holdsSkillText: false,
      holdsPastChatExcerpts: false,
      isBranchedFromShare: false,
    })

    expect(approval.toolApproval(call('call-1', 'memory_write')))
      .toEqual({ type: 'user-approval', reason: 'untrusted-output' })
    expect(approval.isCallCleared('call-1')).toBe(false)
    expect(approval.getPendingDecision('call-1')?.decision.rememberOptions)
      .toEqual(['once'])
  })

  it('runs an untainted native write and clears it, whatever its size',
    () => {
      const approval = createApproval(['create_artifact'])

      expect(approval.toolApproval(call('call-1', 'create_artifact', {
        content: 'x'.repeat(600 * 1024),
      }))).toBe('not-applicable')
      expect(approval.isCallCleared('call-1')).toBe(true)
    })

  it('records a connector read when it is decided, so a same-step '
    + 'artifact write asks', () => {
    const approval = createApproval(['create_artifact'], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'list_issues',
        readOnly: true,
      }),
    ])

    expect(approval.toolApproval(call('call-1', 'mcp__linear__list_issues')))
      .toBe('not-applicable')
    expect(approval.toolApproval(call('call-2', 'create_artifact')))
      .toEqual({ type: 'user-approval', reason: 'untrusted-output' })
    expect([...approval.state.taint]).toEqual(['connector'])
    expect([...approval.state.readSources]).toEqual(['connector:c1'])
    expect(approval.state.counters.connectorCalls).toBe(1)
  })

  it('asks cross-source for a second connector after the first was read',
    () => {
      const approval = createApproval([], [
        connectorEntry({
          connectorId: 'c1',
          slug: 'linear',
          tool: 'list_issues',
          readOnly: true,
        }),
        connectorEntry({
          connectorId: 'c2',
          slug: 'notion',
          tool: 'list_pages',
          readOnly: true,
        }),
      ])

      approval.toolApproval(call('call-1', 'mcp__linear__list_issues'))

      expect(approval.toolApproval(call('call-2', 'mcp__notion__list_pages')))
        .toEqual({ type: 'user-approval', reason: 'cross-source' })
      expect(approval.toolApproval(call('call-3', 'mcp__linear__list_issues')))
        .toBe('not-applicable')
    })

  it('asks always-ask for a connector tool that is not read-only', () => {
    const approval = createApproval([], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'create_issue',
        readOnly: false,
      }),
    ])

    expect(approval.toolApproval(call('call-1', 'mcp__linear__create_issue')))
      .toEqual({ type: 'user-approval', reason: 'always-ask' })
  })

  it('never gates a provider-executed call and taints the send with web',
    () => {
      const approval = createApproval(['memory_write'])

      expect(approval.toolApproval({
        toolCall: {
          toolCallId: 'call-1',
          toolName: 'web_search_preview',
          input: {},
          providerExecuted: true,
        },
      })).toBe('not-applicable')
      expect([...approval.state.taint]).toEqual(['web'])
    })

  it('denies a tool with no entry, an input over the cap and the 11th '
    + 'pending call', () => {
    const approval = createApproval(['memory_write'])

    presetApprovalTaint(approval.state, {
      requestedTools: [],
      holdsUntrustedKnowledge: false,
      holdsArtifactContext: false,
      holdsSkillText: true,
      holdsPastChatExcerpts: false,
      isBranchedFromShare: false,
    })

    expect(approval.toolApproval(call('call-x', 'unknown_tool')))
      .toEqual({ type: 'denied', reason: 'missing-tool' })
    expect(approval.toolApproval(call('call-y', 'memory_write', {
      body: 'x'.repeat(70 * 1024),
    }))).toEqual({ type: 'denied', reason: 'over-cap' })

    for (let index = 0; index < 10; index++) {
      expect(approval.toolApproval(call(`call-${index}`, 'memory_write')))
        .toMatchObject({ type: 'user-approval' })
    }

    expect(approval.toolApproval(call('call-10', 'memory_write')))
      .toEqual({ type: 'denied', reason: 'over-cap' })
  })

  it('can only ask when a tool other than a native read is registered',
    () => {
      expect(createApproval(['read_chat', 'web_search_brave']).canAsk())
        .toBe(false)
      expect(createApproval(['create_artifact']).canAsk()).toBe(true)
    })
})

describe('presetApprovalTaint', () => {
  it('maps every untrusted source the send already holds', () => {
    const state = createApprovalState()

    presetApprovalTaint(state, {
      requestedTools: ['web_search_exa'],
      holdsUntrustedKnowledge: true,
      holdsArtifactContext: true,
      holdsSkillText: true,
      holdsPastChatExcerpts: false,
      isBranchedFromShare: true,
    })

    expect([...state.taint].sort()).toEqual([
      'file',
      'knowledge',
      'shared-branch',
      'skill',
      'web',
    ])
  })
})

describe('createToolApprovalStreamCollector', () => {
  async function pipe(
    approval: SendToolApproval,
    chunks: UIMessageChunk[],
  ) {
    const collector = createToolApprovalStreamCollector(approval)
    const stream = collector.apply(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk)
        }

        controller.close()
      },
    }))
    const output: UIMessageChunk[] = []
    const reader = stream.getReader()

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      output.push(value)
    }

    return { collector, output }
  }

  it('strips the signature, adds the data part and collects the request',
    async () => {
      const approval = createApproval(['memory_write'])

      approval.state.taint.add('web')
      approval.toolApproval(call('call-1', 'memory_write', { title: 't' }))

      const { collector, output } = await pipe(approval, [
        { type: 'start-step' },
        {
          type: 'tool-input-available',
          toolCallId: 'call-1',
          toolName: 'memory_write',
          input: { title: 't' },
        },
        {
          type: 'tool-approval-request',
          approvalId: 'approval-0001',
          toolCallId: 'call-1',
          reason: 'untrusted-output',
          signature: 'signed',
        },
        { type: 'finish-step' },
      ])

      expect(output).toContainEqual({
        type: 'tool-approval-request',
        approvalId: 'approval-0001',
        toolCallId: 'call-1',
        reason: 'untrusted-output',
      })
      expect(output).toContainEqual({
        type: TOOL_APPROVAL_DATA_PART_TYPE,
        id: 'call-1',
        data: {
          approvalId: 'approval-0001',
          toolCallId: 'call-1',
          toolName: 'memory_write',
          reason: 'untrusted-output',
          summary: 'Besidka wants to save a memory',
          rememberOptions: ['once'],
        },
      })
      expect(collector.isPaused()).toBe(true)
      expect(collector.getStepCount()).toBe(1)
      expect(collector.getCollected()).toEqual([expect.objectContaining({
        approvalId: 'approval-0001',
        toolName: 'memory_write',
        input: { title: 't' },
        signature: 'signed',
      })])
    })

  it('strips an automatic request of its signature and does not pause',
    async () => {
      const approval = createApproval(['memory_write'])
      const automatic: UIMessageChunk = {
        type: 'tool-approval-request',
        approvalId: 'approval-0002',
        toolCallId: 'call-2',
        isAutomatic: true,
        signature: 'signed',
      }
      const { collector, output } = await pipe(approval, [automatic])

      expect(output).toEqual([{
        type: 'tool-approval-request',
        approvalId: 'approval-0002',
        toolCallId: 'call-2',
        isAutomatic: true,
      }])
      expect(collector.isPaused()).toBe(false)
      expect(collector.getCollected()).toEqual([])
    })
})

describe('recordToolApprovalPause', () => {
  it('writes the pending and turn records, audits connector calls and '
    + 'skips a record that fails', async () => {
    const kv = createKv()
    const approval = createApproval(['memory_write'], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'create_issue',
        readOnly: false,
      }),
    ])

    approval.state.taint.add('web')
    approval.toolApproval(call('call-1', 'mcp__linear__create_issue'))
    approval.toolApproval(call('call-2', 'memory_write'))

    const auditPending = vi.fn(async () => 42)
    const logger = { set: vi.fn() }
    const { written } = await recordToolApprovalPause({
      kv: kv as never,
      userId: 7,
      chatPublicId: 'chat-1',
      messagePublicId: 'message-1',
      approval,
      collected: [
        {
          approvalId: 'approval-0001',
          toolCallId: 'call-1',
          toolName: 'mcp__linear__create_issue',
          input: { title: 'x' },
          signature: 'sig-1',
          pending: approval.getPendingDecision('call-1')!,
        },
        {
          approvalId: 'bad id',
          toolCallId: 'call-2',
          toolName: 'memory_write',
          input: {},
          signature: 'sig-2',
          pending: approval.getPendingDecision('call-2')!,
        },
      ],
      stepCount: 2,
      snapshot: SNAPSHOT,
      auditPending,
      logger,
    })

    expect(written).toBe(1)
    expect(auditPending).toHaveBeenCalledTimes(1)
    expect(JSON.parse(kv.store.get('tool-approval:approval-0001')!))
      .toMatchObject({
        userId: 7,
        family: 'connector',
        access: 'write',
        connectorId: 'c1',
        definitionHash: HASH,
        signature: 'sig-1',
        reason: 'untrusted-output',
        auditCallId: 42,
        summary: 'linear wants to run create_issue',
      })
    expect(JSON.parse(kv.store.get('tool-approval:turn:message-1')!))
      .toMatchObject({
        pendingApprovalIds: ['approval-0001'],
        state: {
          taint: ['web'],
          counters: { rounds: 1, steps: 2 },
        },
      })
    expect(logger.set).toHaveBeenCalledWith(expect.objectContaining({
      attributes: {
        toolApproval: expect.objectContaining({ pendingWrite: 'failed' }),
      },
    }))
  })

  it('writes no turn record when nothing was stored', async () => {
    const kv = createKv()
    const approval = createApproval(['memory_write'])
    const { written } = await recordToolApprovalPause({
      kv: kv as never,
      userId: 7,
      chatPublicId: 'chat-1',
      messagePublicId: 'message-1',
      approval,
      collected: [],
      stepCount: 1,
      snapshot: SNAPSHOT,
      auditPending: async () => null,
      logger: { set: vi.fn() },
    })

    expect(written).toBe(0)
    expect(kv.store.size).toBe(0)
  })
})

describe('chatHasAwaitingApproval', () => {
  it('finds a stored call that waits for approval', () => {
    expect(chatHasAwaitingApproval([
      { parts: [{ type: 'text', text: 'hi' }] },
      {
        parts: [{
          type: 'tool-memory_write',
          toolCallId: 'call-1',
          state: 'approval-requested',
        }],
      },
    ])).toBe(true)
    expect(chatHasAwaitingApproval([
      { parts: [{ type: 'dynamic-tool', state: 'output-available' }] },
    ])).toBe(false)
  })
})
