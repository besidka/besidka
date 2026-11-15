import { describe, expect, it, vi } from 'vitest'
import type { UIMessageChunk } from 'ai'
import { TOOL_APPROVAL_DATA_PART_TYPE } from '#shared/utils/tool-approval-parts'
import {
  buildConnectorApprovalEntry,
  chatHasAwaitingApproval,
  classifyNativeTool,
  createSendToolApproval,
  createToolApprovalStreamCollector,
  hasGuardedProviderTool,
  presetApprovalTaint,
  recordToolApprovalPause,
  withholdProviderTools,
  withProviderToolEgressGuard,
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
  openWorld?: boolean
}) {
  return buildConnectorApprovalEntry({
    exposedName: `mcp__${input.slug}__${input.tool}`,
    connectorId: input.connectorId,
    connectorTitle: input.slug,
    connectorHost: `mcp.${input.slug}.example.com`,
    remoteToolName: input.tool,
    definitionHash: HASH,
    annotations: {
      ...(input.readOnly ? { readOnlyHint: true } : {}),
      ...(input.openWorld === false ? { openWorldHint: false } : {}),
    },
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
    expect(classifyNativeTool('memory_write')).toMatchObject({
      access: 'write',
      writesMemory: true,
      onlyConnectorOrSkillTaint: false,
      taint: null,
    })
    expect(classifyNativeTool('create_artifact')).toMatchObject({
      access: 'write',
      onlyConnectorOrSkillTaint: true,
    })
    expect(classifyNativeTool('create_document').access).toBe('write')
    expect(classifyNativeTool('web_search_brave').taint).toBe('web')
    expect(classifyNativeTool('web_search_preview').taint).toBe('web')
    expect(classifyNativeTool('read_chat')).toMatchObject({
      taint: 'knowledge',
      readsPrivateData: true,
    })
    expect(classifyNativeTool('activate_skill').taint).toBe('skill')
    expect(classifyNativeTool('memory_read')).toMatchObject({
      access: 'read',
      readsPrivateData: true,
      taint: null,
    })
    expect(classifyNativeTool('future_tool')).toMatchObject({
      access: 'write',
      onlyConnectorOrSkillTaint: false,
    })
    expect(classifyNativeTool('code_execution').access).toBe('write')
    expect(classifyNativeTool('web_fetch').access).toBe('write')
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
    expect(approval.consumeClearedCall({
      toolCallId: 'call-1',
      toolName: 'memory_write',
      input: {},
    })).toBe(false)
    expect(approval.getPendingDecision('call-1')?.decision.rememberOptions)
      .toEqual(['once'])
  })

  it('runs an untainted native write and clears it, whatever its size',
    () => {
      const approval = createApproval(['create_artifact'])

      const content = 'x'.repeat(600 * 1024)

      expect(approval.toolApproval(call('call-1', 'create_artifact', {
        content,
      }))).toBe('not-applicable')
      expect(approval.consumeClearedCall({
        toolCallId: 'call-1',
        toolName: 'create_artifact',
        input: { content },
      })).toBe(true)
    })

  it('binds a cleared call to its name and input and uses it up once', () => {
    const approval = createApproval(['create_artifact', 'other_write'])

    approval.toolApproval(call('call-1', 'create_artifact', { title: 'a' }))

    expect(approval.consumeClearedCall({
      toolCallId: 'call-1',
      toolName: 'create_artifact',
      input: { title: 'b' },
    })).toBe(false)
    expect(approval.consumeClearedCall({
      toolCallId: 'call-1',
      toolName: 'other_write',
      input: { title: 'a' },
    })).toBe(false)
    expect(approval.consumeClearedCall({
      toolCallId: 'call-1',
      toolName: 'create_artifact',
      input: { title: 'a' },
    })).toBe(true)
    expect(approval.consumeClearedCall({
      toolCallId: 'call-1',
      toolName: 'create_artifact',
      input: { title: 'a' },
    })).toBe(false)
  })

  it('refuses an uncleared call in a guarded native write', async () => {
    const execute = vi.fn(async () => 'done')
    const approval = createApproval(['create_artifact'])
    const tools = approval.guardNativeWrites({
      create_artifact: { execute },
    } as never) as Record<string, any>

    await expect(async () => {
      await tools.create_artifact.execute({}, { toolCallId: 'call-9' })
    }).rejects.toThrow('not approved')
    expect(execute).not.toHaveBeenCalled()

    approval.toolApproval(call('call-1', 'create_artifact', { title: 'a' }))

    expect(await tools.create_artifact.execute(
      { title: 'a' },
      { toolCallId: 'call-1' },
    )).toBe('done')
  })

  it('asks before an unclassified native write after web taint', () => {
    const approval = createApproval(['future_write'])

    approval.state.taint.add('web')

    expect(approval.toolApproval(call('call-1', 'future_write')))
      .toEqual({ type: 'user-approval', reason: 'untrusted-output' })
  })

  it('asks cross-source for a connector read after search_chats', () => {
    const approval = createApproval(['search_chats'], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'list_issues',
        readOnly: true,
      }),
    ])

    expect(approval.toolApproval(call('call-1', 'search_chats')))
      .toBe('not-applicable')
    expect(approval.toolApproval(call('call-2', 'mcp__linear__list_issues')))
      .toEqual({ type: 'user-approval', reason: 'cross-source' })
    expect([...approval.state.readSources]).toEqual(['besidka'])
  })

  it('asks untrusted-output for an open-world read-only connector tool '
    + 'after taint, and runs a closed-world one', () => {
    const approval = createApproval([], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'list_issues',
        readOnly: true,
      }),
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'get_issue',
        readOnly: true,
        openWorld: false,
      }),
    ])

    approval.state.taint.add('web')

    expect(approval.toolApproval(call('call-1', 'mcp__linear__list_issues')))
      .toEqual({ type: 'user-approval', reason: 'untrusted-output' })
    expect(approval.getPendingDecision('call-1')?.decision.rememberOptions)
      .toEqual(['once'])
    expect(approval.toolApproval(call('call-2', 'mcp__linear__get_issue')))
      .toBe('not-applicable')
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
        .toEqual({ type: 'user-approval', reason: 'untrusted-output' })
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

  it('never gates a provider-executed web search and taints the send',
    () => {
      const approval = createApproval(['memory_write', 'web_search_preview'])

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

  it('never asks for a provider-executed call, which already ran', () => {
    const approval = createApproval(['code_execution'])
    const providerCall = {
      toolCall: {
        toolCallId: 'call-1',
        toolName: 'code_execution',
        input: {},
        providerExecuted: true,
      },
    }

    approval.state.taint.add('web')

    expect(approval.toolApproval(providerCall)).toBe('not-applicable')
    expect(approval.getPendingDecision('call-1')).toBeUndefined()
  })

  it('withholds a provider-executed write only while the policy would ask',
    async () => {
      const approval = createSendToolApproval({ state: createApprovalState() })
      const tools = {
        code_execution: { type: 'provider' },
        web_search: { type: 'provider' },
        memory_write: { execute: vi.fn() },
      } as never

      approval.registerTools(tools)

      expect(approval.listWithheldProviderTools(tools)).toEqual([])
      expect(withholdProviderTools({
        approval,
        tools,
        keepWhenHistoryHolds: null,
      })).toBe(tools)
      expect(hasGuardedProviderTool(approval, tools)).toBe(true)

      approval.state.taint.add('connector')

      expect(approval.listWithheldProviderTools(tools))
        .toEqual(['code_execution'])
      expect(Object.keys(withholdProviderTools({
        approval,
        tools,
        keepWhenHistoryHolds: null,
      }) ?? {})).toEqual(['web_search', 'memory_write'])
      expect(Object.keys(withholdProviderTools({
        approval,
        tools,
        keepWhenHistoryHolds: [{
          type: 'tool-code_execution',
          state: 'output-available',
        }],
      }) ?? {})).toContain('code_execution')

      const prepareStep = withProviderToolEgressGuard({
        approval,
        tools,
        base: () => ({ activeTools: ['code_execution', 'memory_write'] }),
        keepDeclarations: false,
      })

      expect(await prepareStep({} as never))
        .toEqual({ activeTools: ['memory_write'] })
      expect(await withProviderToolEgressGuard({
        approval,
        tools,
        keepDeclarations: true,
      })({} as never)).toBeUndefined()
    })

  it('binds an approval to its call and uses it once', () => {
    const approval = createApproval(['memory_write'])
    const approved = {
      toolCallId: 'call-1',
      toolName: 'memory_write',
      input: { body: 'Likes tea' },
    }

    approval.state.taint.add('web')
    approval.markApprovedByUser(approved)

    expect(approval.toolApproval(call('call-1', 'memory_write', {
      body: 'Card 4111 1111 1111 1111',
    }))).toEqual({ type: 'user-approval', reason: 'untrusted-output' })
    expect(approval.isApprovedByUser({
      ...approved,
      input: { body: 'Card 4111 1111 1111 1111' },
    })).toBe(false)
    expect(approval.isApprovedByUser({
      ...approved,
      toolName: 'memory_forget',
    })).toBe(false)
    expect(approval.isApprovedByUser(approved)).toBe(true)

    approval.consumeApprovedCall('call-1')

    expect(approval.isApprovedByUser(approved)).toBe(false)
    expect(approval.toolApproval(call('call-1', 'memory_write', {
      body: 'Likes tea',
    }))).toEqual({ type: 'user-approval', reason: 'untrusted-output' })
  })

  it('withholds provider web search once the turn read private data', () => {
    const approval = createSendToolApproval({ state: createApprovalState() })
    const tools = {
      web_search: { type: 'provider' },
      google_search: { type: 'provider' },
    } as never

    approval.registerTools(tools)
    approval.state.taint.add('web')

    expect(approval.listWithheldProviderTools(tools)).toEqual([])

    approval.state.readSources.add('connector:c1')

    expect(approval.listWithheldProviderTools(tools))
      .toEqual(['web_search', 'google_search'])
    expect(hasGuardedProviderTool(approval, tools)).toBe(true)
  })

  it('replays a call the user approved without a new decision', () => {
    const approval = createApproval([], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'create_issue',
        readOnly: false,
      }),
    ])

    approval.markApprovedByUser({
      toolCallId: 'call-1',
      toolName: 'mcp__linear__create_issue',
      input: { title: 'x' },
    })

    expect(approval.toolApproval(call(
      'call-1',
      'mcp__linear__create_issue',
      { title: 'x' },
    ))).toBe('not-applicable')
    expect(approval.getPendingDecision('call-1')).toBeUndefined()
    expect(approval.state.counters.connectorCalls).toBe(1)
    expect([...approval.state.taint]).toEqual(['connector'])
    expect(approval.consumeClearedCall({
      toolCallId: 'call-1',
      toolName: 'mcp__linear__create_issue',
      input: { title: 'x' },
    })).toBe(true)
  })

  it('opens no sixth approval round in one user turn', () => {
    const approval = createApproval([], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'create_issue',
        readOnly: false,
      }),
    ])

    approval.state.counters.rounds = 4

    expect(approval.toolApproval(call('call-1', 'mcp__linear__create_issue')))
      .toEqual({ type: 'user-approval', reason: 'always-ask' })

    approval.state.counters.rounds = 5

    expect(approval.toolApproval(call('call-2', 'mcp__linear__create_issue')))
      .toEqual({ type: 'denied', reason: 'over-cap' })
  })

  it('denies a connector call once the turn spent its connector calls', () => {
    const approval = createApproval([], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'list_issues',
        readOnly: true,
      }),
    ])

    approval.state.counters.connectorCalls = 12

    expect(approval.toolApproval(call('call-1', 'mcp__linear__list_issues')))
      .toEqual({ type: 'denied', reason: 'over-cap' })
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
      settleFailedAudit: async () => undefined,
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
        summary: 'linear wants to run mcp__linear__create_issue',
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
      settleFailedAudit: async () => undefined,
      logger: { set: vi.fn() },
    })

    expect(written).toBe(0)
    expect(kv.store.size).toBe(0)
  })
})

describe('recordToolApprovalPause audit settlement', () => {
  it('settles the pending audit row when the record cannot be stored',
    async () => {
      const kv = createKv()
      const approval = createApproval([], [
        connectorEntry({
          connectorId: 'c1',
          slug: 'linear',
          tool: 'create_issue',
          readOnly: false,
        }),
      ])

      approval.toolApproval(call('call-1', 'mcp__linear__create_issue'))

      const settleFailedAudit = vi.fn(async () => undefined)
      const { written } = await recordToolApprovalPause({
        kv: kv as never,
        userId: 7,
        chatPublicId: 'chat-1',
        messagePublicId: 'message-1',
        approval,
        collected: [{
          approvalId: 'bad id',
          toolCallId: 'call-1',
          toolName: 'mcp__linear__create_issue',
          input: {},
          signature: 'sig',
          pending: approval.getPendingDecision('call-1')!,
        }],
        stepCount: 1,
        snapshot: SNAPSHOT,
        auditPending: async () => 9,
        settleFailedAudit,
        logger: { set: vi.fn() },
      })

      expect(written).toBe(0)
      expect(settleFailedAudit).toHaveBeenCalledWith(9)
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
