import { describe, expect, it, vi } from 'vitest'
import type { UIMessageChunk } from 'ai'
import {
  TOOL_APPROVAL_DATA_PART_TYPE,
  TOOL_GRANT_DATA_PART_TYPE,
} from '#shared/utils/tool-approval-parts'
import {
  buildConnectorApprovalEntry,
  buildMemoryApprovalEntries,
  buildMemoryApprovalEntry,
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
import {
  createApprovalState,
  deserializeApprovalState,
  serializeApprovalState,
} from '~~/server/utils/tool-approval/state'
import { hasAlwaysAskToolName } from '~~/server/utils/tool-approval/policy'
import { SEND_TOOL_DENIAL_TEXT } from '~~/server/utils/tool-approval/denial-texts'
import {
  TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN,
} from '#shared/utils/tool-approval-policy'

const HASH = 'a'.repeat(64)
const SNAPSHOT = {
  model: 'claude-haiku-4-5',
  gateway: null,
  reasoning: 'off' as const,
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
  destructive?: boolean
  title?: string
  grantHashes?: { always: string | null, chat: string | null }
  isAlwaysDefault?: boolean
}) {
  return buildConnectorApprovalEntry({
    exposedName: `mcp__${input.slug}__${input.tool}`,
    connectorId: input.connectorId,
    connectorTitle: input.slug,
    connectorHost: `mcp.${input.slug}.example.com`,
    remoteToolName: input.tool,
    ...(input.title ? { remoteToolTitle: input.title } : {}),
    definitionHash: HASH,
    annotations: {
      ...(input.readOnly ? { readOnlyHint: true } : {}),
      ...(input.openWorld === false ? { openWorldHint: false } : {}),
      ...(input.destructive ? { destructiveHint: true } : {}),
    },
    ...(input.grantHashes ? { grantHashes: input.grantHashes } : {}),
    ...(input.isAlwaysDefault ? { isAlwaysDefault: true } : {}),
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

function stepCall(
  messages: unknown[],
  toolCallId: string,
  toolName: string,
  input: unknown = {},
) {
  return { toolCall: { toolCallId, toolName, input }, messages }
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
      .toEqual(['once', 'always'])
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

  it('asks default with every answer for a read-only connector tool set '
    + 'to Needs approval', () => {
    const approval = createApproval([], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'list_issues',
        readOnly: true,
      }),
    ])

    expect(approval.toolApproval(call('call-1', 'mcp__linear__list_issues')))
      .toEqual({ type: 'user-approval', reason: 'default' })
    expect(approval.getPendingDecision('call-1')?.decision.rememberOptions)
      .toEqual(['once', 'chat', 'always'])
  })

  it('runs an Always allow connector read after search_chats and asks one '
    + 'set to Needs approval with every answer', () => {
    const granted = createApproval(['search_chats'], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'list_issues',
        readOnly: true,
        grantHashes: { always: HASH, chat: null },
      }),
    ])
    const approval = createApproval(['search_chats'], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'list_issues',
        readOnly: true,
      }),
    ])

    expect(granted.toolApproval(call('call-1', 'search_chats')))
      .toBe('not-applicable')
    expect(granted.toolApproval(call('call-2', 'mcp__linear__list_issues')))
      .toBe('not-applicable')
    expect(approval.toolApproval(call('call-1', 'search_chats')))
      .toBe('not-applicable')
    expect(approval.toolApproval(call('call-2', 'mcp__linear__list_issues')))
      .toEqual({ type: 'user-approval', reason: 'untrusted-output' })
    expect(approval.getPendingDecision('call-2')?.decision.rememberOptions)
      .toEqual(['once', 'chat', 'always'])
    expect([...approval.state.readSources]).toEqual(['besidka'])
  })

  it('runs the default Always allow of a plain read without a grant marker',
    () => {
      const approval = createApproval([], [
        buildConnectorApprovalEntry({
          exposedName: 'mcp__linear__list_issues',
          connectorId: 'c1',
          connectorTitle: 'Linear',
          connectorHost: 'mcp.linear.example.com',
          remoteToolName: 'list_issues',
          definitionHash: HASH,
          annotations: { readOnlyHint: true },
          grantHashes: { always: HASH, chat: null },
          isAlwaysDefault: true,
        }),
      ])

      expect(approval.toolApproval(call('call-1', 'mcp__linear__list_issues')))
        .toBe('not-applicable')
      expect(approval.getGrantScope('call-1')).toBeNull()
    })

  it('runs an Always allow read after its own connector\'s result', () => {
    const approval = createApproval([], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'list_issues',
        readOnly: true,
        grantHashes: { always: HASH, chat: null },
      }),
    ])

    approval.state.taint.add('connector')
    approval.state.readSources.add('connector:c1')

    expect(approval.toolApproval(call('call-1', 'mcp__linear__list_issues')))
      .toBe('not-applicable')
    expect(approval.getGrantScope('call-1')).toBe('always')
  })

  it('records a connector read when it is decided, so the next step\'s '
    + 'artifact write asks', () => {
    const approval = createApproval(['create_artifact'], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'list_issues',
        readOnly: true,
        grantHashes: { always: HASH, chat: null },
      }),
    ])
    const firstStep: unknown[] = []
    const secondStep: unknown[] = []

    expect(approval.toolApproval(stepCall(
      firstStep,
      'call-1',
      'mcp__linear__list_issues',
    ))).toBe('not-applicable')
    expect(approval.toolApproval(stepCall(
      firstStep,
      'call-2',
      'create_artifact',
    ))).toBe('not-applicable')
    expect([...approval.state.taint]).toEqual(['connector'])
    expect([...approval.state.readSources]).toEqual(['connector:c1'])
    expect(approval.state.counters.connectorCalls).toBe(1)
    expect(approval.toolApproval(stepCall(
      secondStep,
      'call-3',
      'create_artifact',
    ))).toEqual({ type: 'user-approval', reason: 'untrusted-output' })
  })

  it('asks cross-source for a write to a second connector in the next step',
    () => {
      const approval = createApproval([], [
        connectorEntry({
          connectorId: 'c1',
          slug: 'linear',
          tool: 'list_issues',
          readOnly: true,
          grantHashes: { always: HASH, chat: null },
        }),
        connectorEntry({
          connectorId: 'c2',
          slug: 'notion',
          tool: 'create_page',
          readOnly: false,
        }),
      ])

      approval.toolApproval(stepCall([], 'call-1', 'mcp__linear__list_issues'))

      expect(approval.toolApproval(
        stepCall([], 'call-2', 'mcp__notion__create_page'),
      )).toEqual({ type: 'user-approval', reason: 'untrusted-output' })
    })

  describe('one model step (Part 1, 2026-11-15)', () => {
    function notionEntries(ungranted: readonly string[] = []) {
      return [
        ['c1', 'notion', 'notion-list-private-pages', true],
        ['c1', 'notion', 'notion-search', true],
        ['c1', 'notion', 'notion-create-pages', false],
        ['c2', 'linear', 'create_issue', false],
      ].map(([connectorId, slug, tool, readOnly]) => {
        return connectorEntry({
          connectorId: connectorId as string,
          slug: slug as string,
          tool: tool as string,
          readOnly: readOnly as boolean,
          ...(ungranted.includes(tool as string)
            ? {}
            : { grantHashes: { always: HASH, chat: null } }),
        })
      })
    }

    it('judges every call of a step against the state at its start', () => {
      const approval = createApproval(['create_artifact'], notionEntries())
      const step: unknown[] = []

      expect(approval.toolApproval(stepCall(
        step,
        'call-1',
        'mcp__notion__notion-list-private-pages',
      ))).toBe('not-applicable')
      expect(approval.toolApproval(stepCall(
        step,
        'call-2',
        'mcp__notion__notion-search',
      ))).toBe('not-applicable')
      expect(approval.toolApproval(stepCall(
        step,
        'call-3',
        'mcp__linear__create_issue',
      ))).toBe('not-applicable')
      expect(approval.toolApproval(stepCall(
        step,
        'call-4',
        'create_artifact',
      ))).toBe('not-applicable')
      expect([...approval.state.readSources].sort())
        .toEqual(['connector:c1', 'connector:c2'])
    })

    it('judges the next step against the taint the step recorded', () => {
      const approval = createApproval([], notionEntries(['create_issue']))

      approval.toolApproval(stepCall(
        [],
        'call-1',
        'mcp__notion__notion-search',
      ))

      expect(approval.toolApproval(stepCall(
        [],
        'call-2',
        'mcp__notion__notion-create-pages',
      ))).toBe('not-applicable')
      expect(approval.toolApproval(stepCall(
        [],
        'call-3',
        'mcp__linear__create_issue',
      ))).toEqual({ type: 'user-approval', reason: 'untrusted-output' })
    })

    it('counts a provider-run call within its own step', () => {
      const approval = createApproval(
        ['web_search'],
        notionEntries(['notion-create-pages', 'notion-search']),
      )
      const step: unknown[] = []

      approval.toolApproval({
        toolCall: {
          toolCallId: 'call-1',
          toolName: 'web_search',
          input: {},
          providerExecuted: true,
        },
        messages: step,
      })

      expect(approval.toolApproval(stepCall(
        step,
        'call-2',
        'mcp__notion__notion-create-pages',
      ))).toEqual({ type: 'user-approval', reason: 'untrusted-output' })
      expect(approval.toolApproval(stepCall(
        step,
        'call-3',
        'mcp__notion__notion-search',
      ))).toEqual({ type: 'user-approval', reason: 'untrusted-output' })
    })

    it('asks connector reads after taint preset before the first step',
      () => {
        const approval = createApproval([], notionEntries([
          'notion-search',
          'notion-create-pages',
        ]))

        presetApprovalTaint(approval.state, {
          requestedTools: ['web_search'],
          holdsUntrustedKnowledge: true,
          holdsArtifactContext: true,
          holdsSkillText: true,
          holdsPastChatExcerpts: true,
          isBranchedFromShare: true,
          holdsUserAttachments: true,
          holdsBesidkaToolHistory: true,
        })

        expect(approval.toolApproval(stepCall(
          [],
          'call-1',
          'mcp__notion__notion-search',
        ))).toEqual({ type: 'user-approval', reason: 'untrusted-output' })
        expect(approval.getPendingDecision('call-1')?.decision.rememberOptions)
          .toEqual(['once', 'chat', 'always'])
        expect(approval.toolApproval(stepCall(
          [],
          'call-2',
          'mcp__notion__notion-create-pages',
        ))).toEqual({ type: 'user-approval', reason: 'untrusted-output' })
        expect(approval.getPendingDecision('call-2')?.decision.rememberOptions)
          .toEqual(['once', 'chat', 'always'])
      })

    it('runs granted connector calls after taint preset before the first '
      + 'step (owner decision, 2026-11-20)', () => {
      const approval = createApproval([], notionEntries())

      presetApprovalTaint(approval.state, {
        requestedTools: ['web_search'],
        holdsUntrustedKnowledge: true,
        holdsArtifactContext: false,
        holdsSkillText: false,
        holdsPastChatExcerpts: false,
        isBranchedFromShare: false,
      })

      for (const [toolCallId, toolName] of [
        ['call-1', 'mcp__notion__notion-search'],
        ['call-2', 'mcp__notion__notion-create-pages'],
        ['call-3', 'mcp__linear__create_issue'],
      ]) {
        expect(approval.toolApproval(stepCall([], toolCallId!, toolName!)))
          .toBe('not-applicable')
        expect(approval.getGrantScope(toolCallId!)).toBe('always')
      }
    })
  })

  it('asks default with every answer for a plain connector write', () => {
    const approval = createApproval([], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'create_issue',
        readOnly: false,
      }),
    ])

    expect(approval.toolApproval(call('call-1', 'mcp__linear__create_issue')))
      .toEqual({ type: 'user-approval', reason: 'default' })
    expect(approval.getPendingDecision('call-1')?.decision.rememberOptions)
      .toEqual(['once', 'chat', 'always'])
  })

  it('asks always-ask with every answer for destructiveHint true and runs '
    + 'it under the user\'s grant', () => {
    const entryOf = (input: {
      grantHashes?: { always: string | null, chat: string | null }
      isAlwaysDefault?: boolean
    }) => {
      return connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'archive_issue',
        readOnly: false,
        destructive: true,
        ...input,
      })
    }
    const asked = createApproval([], [entryOf({})])
    const granted = createApproval([], [
      entryOf({ grantHashes: { always: HASH, chat: null } }),
    ])
    const defaulted = createApproval([], [
      entryOf({
        grantHashes: { always: HASH, chat: null },
        isAlwaysDefault: true,
      }),
    ])

    expect(asked.toolApproval(call('call-1', 'mcp__linear__archive_issue')))
      .toEqual({ type: 'user-approval', reason: 'always-ask' })
    expect(asked.getPendingDecision('call-1')?.decision.rememberOptions)
      .toEqual(['once', 'chat', 'always'])
    expect(granted.toolApproval(call('call-1', 'mcp__linear__archive_issue')))
      .toBe('not-applicable')
    expect(defaulted.toolApproval(call('call-1', 'mcp__linear__archive_issue')))
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
        web_fetch: { type: 'provider' },
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
        .toEqual(['web_fetch'])
      expect(Object.keys(withholdProviderTools({
        approval,
        tools,
        keepWhenHistoryHolds: null,
      }) ?? {})).toEqual(['web_search', 'memory_write'])
      expect(Object.keys(withholdProviderTools({
        approval,
        tools,
        keepWhenHistoryHolds: [{
          type: 'tool-web_fetch',
          state: 'output-available',
        }],
      }) ?? {})).toContain('web_fetch')

      const prepareStep = withProviderToolEgressGuard({
        approval,
        tools,
        base: () => ({ activeTools: ['web_fetch', 'memory_write'] }),
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

  it.each(['web', 'connector', 'skill', 'knowledge', 'file', 'besidka'] as const)(
    'never withholds provider code execution after %s taint',
    (kind) => {
      const approval = createSendToolApproval({
        state: createApprovalState(),
      })
      const tools = { code_execution: { type: 'provider' } } as never

      approval.registerTools(tools)
      approval.state.taint.add(kind)
      approval.state.toolReadSources.add('connector:c1')

      expect(approval.listWithheldProviderTools(tools)).toEqual([])
      expect(withholdProviderTools({
        approval,
        tools,
        keepWhenHistoryHolds: null,
      })).toBe(tools)
    },
  )

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

  it('keeps provider web search with knowledge excerpts in the prompt, and '
    + 'withholds it after a tool read private data', () => {
    const approval = createSendToolApproval({ state: createApprovalState() })
    const tools = {
      web_search: { type: 'provider' },
      google_search: { type: 'provider' },
      search_chats: { execute: vi.fn() },
    } as never

    approval.registerTools(tools)
    presetApprovalTaint(approval.state, {
      requestedTools: ['web_search'],
      holdsUntrustedKnowledge: true,
      holdsArtifactContext: false,
      holdsSkillText: false,
      holdsPastChatExcerpts: true,
      isBranchedFromShare: false,
    })

    expect([...approval.state.readSources]).toEqual(['besidka'])
    expect(approval.listWithheldProviderTools(tools)).toEqual([])
    expect(hasGuardedProviderTool(approval, tools)).toBe(true)

    expect(approval.toolApproval(call('call-1', 'search_chats', {
      query: 'pasta',
    }))).toBe('not-applicable')
    expect(approval.listWithheldProviderTools(tools))
      .toEqual(['web_search', 'google_search'])
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
      .toEqual({ type: 'user-approval', reason: 'default' })

    approval.state.counters.rounds = 5

    expect(approval.toolApproval(call('call-2', 'mcp__linear__create_issue')))
      .toEqual({ type: 'denied', reason: SEND_TOOL_DENIAL_TEXT.rounds })
    expect(approval.getDenials()).toEqual({ rounds: 1 })
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

    approval.state.counters.connectorCalls
      = TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN - 1

    expect(approval.toolApproval(call('call-1', 'mcp__linear__list_issues')))
      .toMatchObject({ type: 'user-approval' })

    approval.state.counters.connectorCalls
      = TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN

    expect(approval.toolApproval(call('call-2', 'mcp__linear__list_issues')))
      .toEqual({
        type: 'denied',
        reason: SEND_TOOL_DENIAL_TEXT['connector-calls'],
      })
  })

  it('tells the model which limit it reached and what to do next', () => {
    for (const text of Object.values(SEND_TOOL_DENIAL_TEXT)) {
      expect(text).not.toContain('over-cap')
      expect(text).toMatch(/did not run/)
    }

    expect(SEND_TOOL_DENIAL_TEXT['connector-calls'])
      .toContain(`${TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN} connector calls`)
    expect(SEND_TOOL_DENIAL_TEXT['connector-calls'])
      .toContain('Stop calling tools now')
    expect(SEND_TOOL_DENIAL_TEXT.pending).toContain('Make it again after')
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
      .toEqual({
        type: 'denied',
        reason: SEND_TOOL_DENIAL_TEXT['missing-tool'],
      })
    expect(approval.toolApproval(call('call-y', 'memory_write', {
      body: 'x'.repeat(70 * 1024),
    }))).toEqual({ type: 'denied', reason: SEND_TOOL_DENIAL_TEXT.payload })

    for (let index = 0; index < 10; index++) {
      expect(approval.toolApproval(call(`call-${index}`, 'memory_write')))
        .toMatchObject({ type: 'user-approval' })
    }

    expect(approval.toolApproval(call('call-10', 'memory_write')))
      .toEqual({ type: 'denied', reason: SEND_TOOL_DENIAL_TEXT.pending })
    expect(approval.getDenials()).toEqual({
      'missing-tool': 1,
      'payload': 1,
      'pending': 1,
    })
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
          rememberOptions: ['once', 'always'],
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

  it('writes the described summary and the preview into the data part',
    async () => {
      const approval = createSendToolApproval({ state: createApprovalState() })

      approval.registerTools({ besidka__add_note: {} } as never, new Map([[
        'besidka__add_note',
        {
          descriptor: {
            family: 'besidka',
            access: 'write',
            toolName: 'besidka__add_note',
            definitionHash: HASH,
            destructiveHint: false,
          },
          summary: 'Add a note',
          describe: async () => 'Add the note "Rules"',
          preview: (input: unknown) => (input as { body: string }).body,
          permissionMode: 'ask',
          taint: 'besidka',
          readSource: 'besidka',

          connector: null,
        },
      ]]))
      approval.toolApproval(call('call-1', 'besidka__add_note', {
        body: 'Be brief.',
      }))

      const { collector, output } = await pipe(approval, [
        {
          type: 'tool-input-available',
          toolCallId: 'call-1',
          toolName: 'besidka__add_note',
          input: { body: 'Be brief.' },
        },
        {
          type: 'tool-approval-request',
          approvalId: 'approval-0001',
          toolCallId: 'call-1',
          reason: 'default',
          signature: 'signed',
        },
      ])

      expect(output).toContainEqual(expect.objectContaining({
        type: TOOL_APPROVAL_DATA_PART_TYPE,
        data: expect.objectContaining({
          summary: 'Add the note "Rules"',
          preview: 'Be brief.',
        }),
      }))
      expect(collector.getCollected()[0]?.pending.summary)
        .toBe('Add the note "Rules"')
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

describe('user grants in the send', () => {
  const OLD_HASH = 'b'.repeat(64)

  function writeEntry(
    grantHashes: { always: string | null, chat: string | null },
    connectorId = 'c1',
  ) {
    return connectorEntry({
      connectorId,
      slug: 'linear',
      tool: 'create_issue',
      readOnly: false,
      grantHashes,
    })
  }

  it('runs a plain write with an "in this chat" grant for its hash', () => {
    const approval = createApproval([], [
      writeEntry({ always: null, chat: HASH }),
    ])

    expect(approval.toolApproval(call('call-1', 'mcp__linear__create_issue')))
      .toBe('not-applicable')
    expect(approval.consumeClearedCall({
      toolCallId: 'call-1',
      toolName: 'mcp__linear__create_issue',
      input: {},
    })).toBe(true)
  })

  it('runs a plain write with an "always" grant for its hash', () => {
    const approval = createApproval([], [
      writeEntry({ always: HASH, chat: null }),
    ])

    expect(approval.toolApproval(call('call-1', 'mcp__linear__create_issue')))
      .toBe('not-applicable')
  })

  it('asks again with every answer when the tool changed since the grant',
    () => {
      const approval = createApproval([], [
        writeEntry({ always: OLD_HASH, chat: OLD_HASH }),
      ])

      expect(
        approval.toolApproval(call('call-1', 'mcp__linear__create_issue')),
      ).toEqual({ type: 'user-approval', reason: 'default' })
      expect(approval.getPendingDecision('call-1')?.decision.rememberOptions)
        .toEqual(['once', 'chat', 'always'])
    })

  it.each([
    ['web', ['web'], []],
    ['connector', ['connector'], []],
    ['skill', ['skill'], []],
  ] as const)(
    'runs a granted write after %s taint and asks an ungranted one with '
    + 'every answer',
    (_name, taint) => {
      const granted = createApproval([], [
        writeEntry({ always: HASH, chat: null }),
      ])
      const approval = createApproval([], [
        writeEntry({ always: null, chat: null }),
      ])

      taint.forEach((kind) => {
        granted.state.taint.add(kind)
        approval.state.taint.add(kind)
      })

      expect(
        granted.toolApproval(call('call-1', 'mcp__linear__create_issue')),
      ).toBe('not-applicable')
      expect(granted.getGrantScope('call-1')).toBe('always')
      expect(
        approval.toolApproval(call('call-1', 'mcp__linear__create_issue')),
      ).toEqual({ type: 'user-approval', reason: 'untrusted-output' })
      expect(approval.getPendingDecision('call-1')?.decision.rememberOptions)
        .toEqual(['once', 'chat', 'always'])
    },
  )

  it('runs a chat-granted write after another source and asks an '
    + 'ungranted one cross-source with every answer', () => {
    const granted = createApproval([], [
      writeEntry({ always: null, chat: HASH }),
    ])
    const approval = createApproval([], [
      writeEntry({ always: null, chat: null }),
    ])

    granted.state.readSources.add('connector:c2')
    approval.state.readSources.add('connector:c2')

    expect(granted.toolApproval(call('call-1', 'mcp__linear__create_issue')))
      .toBe('not-applicable')
    expect(granted.getGrantScope('call-1')).toBe('chat')
    expect(
      approval.toolApproval(call('call-1', 'mcp__linear__create_issue')),
    ).toEqual({ type: 'user-approval', reason: 'cross-source' })
    expect(approval.getPendingDecision('call-1')?.decision.rememberOptions)
      .toEqual(['once', 'chat', 'always'])
  })

  it('runs a second granted write after its own connector\'s result',
    () => {
      const approval = createApproval([], [
        writeEntry({ always: HASH, chat: HASH }),
      ])

      expect(
        approval.toolApproval(call('call-1', 'mcp__linear__create_issue')),
      ).toBe('not-applicable')
      expect(
        approval.toolApproval(call('call-2', 'mcp__linear__create_issue')),
      ).toBe('not-applicable')
    })

  it('never lets a grant of another connector match', () => {
    const entry = writeEntry({ always: HASH, chat: HASH })
    const approval = createApproval([], [{
      ...entry,
      userGrants: {
        always: { ...entry.userGrants!.always!, connectorId: 'c9' },
        chat: { ...entry.userGrants!.chat!, connectorId: 'c9' },
      },
    }])

    expect(approval.toolApproval(call('call-1', 'mcp__linear__create_issue')))
      .toEqual({ type: 'user-approval', reason: 'default' })
  })

  it('honors a chat grant on a read-only tool after its own connector and '
    + 'after the web', () => {
    const approval = createApproval([], [
      connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'list_issues',
        readOnly: true,
        grantHashes: { always: null, chat: HASH },
      }),
    ])

    approval.state.taint.add('connector')
    approval.state.readSources.add('connector:c1')

    expect(approval.toolApproval(call('call-1', 'mcp__linear__list_issues')))
      .toBe('not-applicable')
    expect(approval.getGrantScope('call-1')).toBe('chat')

    approval.state.taint.add('web')

    expect(approval.toolApproval(call('call-2', 'mcp__linear__list_issues')))
      .toBe('not-applicable')
    expect(approval.getGrantScope('call-2')).toBe('chat')
  })
})

describe('grants audit follow-ups', () => {
  const NO_PRESET = {
    requestedTools: [],
    holdsUntrustedKnowledge: false,
    holdsArtifactContext: false,
    holdsSkillText: false,
    holdsPastChatExcerpts: false,
    isBranchedFromShare: false,
  }

  function grantedWrite(tool = 'create_issue', title?: string) {
    return connectorEntry({
      connectorId: 'c1',
      slug: 'linear',
      tool,
      readOnly: false,
      ...(title ? { title } : {}),
      grantHashes: { always: HASH, chat: HASH },
    })
  }

  describe('user attachments (H1)', () => {
    it('taints the send with file, and the taint survives a resume', () => {
      const state = createApprovalState()

      presetApprovalTaint(state, { ...NO_PRESET, holdsUserAttachments: true })

      expect([...state.taint]).toEqual(['file'])

      const restored = deserializeApprovalState(
        JSON.parse(JSON.stringify(serializeApprovalState(state))),
      )

      expect(restored.ok && [...restored.state.taint]).toEqual(['file'])
    })

    it('adds no taint without attachments', () => {
      const state = createApprovalState()

      presetApprovalTaint(state, { ...NO_PRESET, holdsUserAttachments: false })

      expect(state.taint.size).toBe(0)
    })

    it('runs a granted write in a send with an attachment (owner '
      + 'decision, 2026-11-20)', () => {
      const approval = createApproval([], [grantedWrite()])

      presetApprovalTaint(approval.state, {
        ...NO_PRESET,
        holdsUserAttachments: true,
      })

      expect(
        approval.toolApproval(call('call-1', 'mcp__linear__create_issue')),
      ).toBe('not-applicable')
    })

    it('asks for a memory write and keeps code execution with an '
      + 'attachment', () => {
      const approval = createSendToolApproval({
        state: createApprovalState(),
      })
      const tools = {
        code_execution: { type: 'provider' },
        memory_write: { execute: vi.fn() },
      } as never

      approval.registerTools(tools)
      presetApprovalTaint(approval.state, {
        ...NO_PRESET,
        holdsUserAttachments: true,
      })

      expect(approval.toolApproval(call('call-1', 'memory_write')))
        .toEqual({ type: 'user-approval', reason: 'untrusted-output' })
      expect(approval.listWithheldProviderTools(tools)).toEqual([])
    })
  })

  describe('grant marker (M1)', () => {
    it('records which user grant let a call run', () => {
      const always = createApproval([], [connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'create_issue',
        readOnly: false,
        grantHashes: { always: HASH, chat: null },
      })])
      const chat = createApproval([], [connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'create_issue',
        readOnly: false,
        grantHashes: { always: null, chat: HASH },
      })])

      always.toolApproval(call('call-1', 'mcp__linear__create_issue'))
      chat.toolApproval(call('call-1', 'mcp__linear__create_issue'))

      expect(always.getGrantScope('call-1')).toBe('always')
      expect(chat.getGrantScope('call-1')).toBe('chat')
    })

    it('never runs a read on its read-only hint alone', () => {
      const approval = createApproval([], [connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'list_issues',
        readOnly: true,
      })])

      expect(approval.toolApproval(call('call-1', 'mcp__linear__list_issues')))
        .toEqual({ type: 'user-approval', reason: 'default' })
      expect(approval.getGrantScope('call-1')).toBeNull()
    })

    it('marks a read that ran on Always allow', () => {
      const approval = createApproval([], [connectorEntry({
        connectorId: 'c1',
        slug: 'linear',
        tool: 'list_issues',
        readOnly: true,
        grantHashes: { always: HASH, chat: null },
      })])

      expect(approval.toolApproval(call('call-1', 'mcp__linear__list_issues')))
        .toBe('not-applicable')
      expect(approval.getGrantScope('call-1')).toBe('always')
    })

    it('writes a data-tool-grant part after the output of a granted call',
      async () => {
        const approval = createApproval([], [grantedWrite()])

        approval.toolApproval(call('call-1', 'mcp__linear__create_issue'))

        const collector = createToolApprovalStreamCollector(approval)
        const chunks: UIMessageChunk[] = [
          {
            type: 'tool-input-available',
            toolCallId: 'call-1',
            toolName: 'mcp__linear__create_issue',
            input: {},
            dynamic: true,
          },
          {
            type: 'tool-output-available',
            toolCallId: 'call-1',
            output: 'ok',
            dynamic: true,
          },
        ]
        const output: UIMessageChunk[] = []
        const reader = collector.apply(new ReadableStream({
          start(controller) {
            chunks.forEach(chunk => controller.enqueue(chunk))
            controller.close()
          },
        })).getReader()

        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            break
          }

          output.push(value)
        }

        expect(output.map(chunk => chunk.type)).toEqual([
          'tool-input-available',
          'tool-output-available',
          TOOL_GRANT_DATA_PART_TYPE,
        ])
        expect(output[2]).toEqual({
          type: TOOL_GRANT_DATA_PART_TYPE,
          id: 'grant-call-1',
          data: {
            toolCallId: 'call-1',
            toolName: 'mcp__linear__create_issue',
            scope: 'always',
          },
        })
      })
  })

  describe('name heuristic (M2)', () => {
    it.each([
      'delete_issue',
      'deleteIssue',
      'RemoveMember',
      'revoke-token',
      'destroy',
      'drop_table',
      'purgeCache',
      'invite_user',
      'share_file',
      'transferOwnership',
      'PUBLISH_PAGE',
      'send_email',
      'sendMessage',
      'post-comment',
      'forwardMessage',
      'reply_to_thread',
      'unshare_page',
      'unpublishPost',
    ])('treats %s as always-ask', (name) => {
      expect(hasAlwaysAskToolName(name)).toBe(true)
    })

    it.each([
      'create_issue',
      'dropdown_list',
      'shared_drives_list',
      'list_publishers',
      'removal_status',
      'search_posts',
      'list_replies',
      'get_sender',
      'list_shares',
      'postal_code_lookup',
    ])('leaves %s alone', (name) => {
      expect(hasAlwaysAskToolName(name)).toBe(false)
    })

    it.each(['send_email', 'sendMessage', 'post-comment', 'forwardMessage',
      'unshare_page'])(
      'asks for read-only-labeled %s until the user allows it, also after '
      + 'its own connector',
      (tool) => {
        const entry = connectorEntry({
          connectorId: 'c1',
          slug: 'mail',
          tool,
          readOnly: true,
          grantHashes: { always: HASH, chat: null },
          isAlwaysDefault: true,
        })
        const approval = createApproval([], [entry])

        approval.state.taint.add('connector')
        approval.state.readSources.add('connector:c1')

        expect(entry.descriptor).toMatchObject({
          access: 'write',
          destructiveHint: true,
        })
        expect(approval.toolApproval(call('call-1', `mcp__mail__${tool}`)))
          .toEqual({ type: 'user-approval', reason: 'always-ask' })
        expect(approval.getPendingDecision('call-1')?.decision.rememberOptions)
          .toEqual(['once', 'chat', 'always'])
      },
    )

    it('matches the title too, never the exposed name', () => {
      expect(hasAlwaysAskToolName('update_item', 'Share item with a team'))
        .toBe(true)
      expect(hasAlwaysAskToolName('mcp__share__create_issue')).toBe(true)
      expect(grantedWrite('create_issue').descriptor.destructiveHint)
        .toBe(false)
    })

    it('runs a tool named for deletion only under the user\'s own grant',
      () => {
        const approval = createApproval([], [grantedWrite('delete_issue')])
        const asked = createApproval([], [connectorEntry({
          connectorId: 'c1',
          slug: 'linear',
          tool: 'delete_issue',
          readOnly: false,
        })])

        expect(
          approval.toolApproval(call('call-1', 'mcp__linear__delete_issue')),
        ).toBe('not-applicable')
        expect(
          asked.toolApproval(call('call-1', 'mcp__linear__delete_issue')),
        ).toEqual({ type: 'user-approval', reason: 'always-ask' })
        expect(asked.getPendingDecision('call-1')?.decision.rememberOptions)
          .toEqual(['once', 'chat', 'always'])
      })

    it('never auto-runs a read-only tool whose title shares data', () => {
      const entry = connectorEntry({
        connectorId: 'c1',
        slug: 'drive',
        tool: 'file_access',
        title: 'Share file',
        readOnly: true,
      })
      const approval = createApproval([], [entry])

      expect(entry.descriptor).toMatchObject({
        access: 'write',
        destructiveHint: true,
      })
      expect(approval.toolApproval(call('call-1', 'mcp__drive__file_access')))
        .toEqual({ type: 'user-approval', reason: 'always-ask' })
    })
  })
})

describe('memory tool Always allow in the send approval', () => {
  const input = { body: 'Likes tea', userRequestQuote: 'remember I like tea' }

  function createMemoryApproval(
    modes: Partial<Record<string, 'blocked' | 'ask' | 'allow'>>,
  ) {
    const approval = createSendToolApproval({ state: createApprovalState() })

    approval.registerTools(
      { memory_write: {}, memory_forget: {} } as never,
      new Map(buildMemoryApprovalEntries(modes)),
    )

    return approval
  }

  it('builds an entry per offered tool with its mode and none for Blocked',
    () => {
      const entries = buildMemoryApprovalEntries({
        memory_write: 'allow',
        memory_forget: 'blocked',
      })

      expect(entries.map(([toolName]) => toolName)).toEqual(['memory_write'])
      expect(entries[0]![1]).toMatchObject({
        permissionMode: 'allow',
        descriptor: {
          family: 'native',
          toolName: 'memory_write',
          writesMemory: true,
        },
      })
      expect(buildMemoryApprovalEntries(undefined)).toEqual([])
      expect(buildMemoryApprovalEntry('memory_forget', 'ask').permissionMode)
        .toBe('ask')
      expect(buildMemoryApprovalEntry('memory_forget', 'allow').permissionMode)
        .toBe('ask')
    })

  it('clears a memory call after every taint kind and marks it as an Always '
    + 'allow grant', () => {
    const approval = createMemoryApproval({ memory_write: 'allow' })

    for (const kind of ['web', 'file', 'knowledge', 'shared-branch'] as const) {
      approval.state.taint.add(kind)
    }

    expect(approval.toolApproval(call('call-1', 'memory_write', input)))
      .toBe('not-applicable')
    expect(approval.getPendingDecision('call-1')).toBeUndefined()
    expect(approval.getGrantScope('call-1')).toBe('always')
  })

  it('still asks after web taint when the tool is on the default mode', () => {
    const approval = createMemoryApproval({})

    approval.state.taint.add('web')

    expect(approval.toolApproval(call('call-1', 'memory_write', input)))
      .toEqual({ type: 'user-approval', reason: 'untrusted-output' })
    expect(approval.getPendingDecision('call-1')?.decision.rememberOptions)
      .toEqual(['once', 'always'])
  })

  it('never clears memory_forget, even with a stored Always allow', () => {
    const approval = createMemoryApproval({
      memory_write: 'allow',
      memory_forget: 'allow',
    })

    approval.state.taint.add('web')

    expect(approval.toolApproval(call('call-1', 'memory_forget', {
      id: 'x',
      userRequestQuote: 'forget it',
    }))).toEqual({ type: 'user-approval', reason: 'untrusted-output' })
    expect(approval.getPendingDecision('call-1')?.decision.rememberOptions)
      .toEqual(['once'])
  })

  it('keeps the other tool asking when only one is set to Always allow', () => {
    const approval = createMemoryApproval({ memory_write: 'allow' })

    approval.state.taint.add('web')

    expect(approval.toolApproval(call('call-1', 'memory_forget', {
      id: 'x',
      userRequestQuote: 'forget it',
    }))).toEqual({ type: 'user-approval', reason: 'untrusted-output' })
  })

  it('lifts the lock for the cleared call only, once', () => {
    const approval = createMemoryApproval({ memory_write: 'allow' })
    const cleared = {
      toolCallId: 'call-1',
      toolName: 'memory_write',
      input,
    }

    approval.state.taint.add('web')
    approval.toolApproval(call('call-1', 'memory_write', input))

    expect(approval.consumeUserSettingCall({
      ...cleared,
      toolCallId: 'call-2',
    })).toBe(false)
    expect(approval.consumeUserSettingCall({
      ...cleared,
      toolName: 'memory_forget',
    })).toBe(false)
    expect(approval.consumeUserSettingCall({
      ...cleared,
      input: { ...input, body: 'Likes coffee' },
    })).toBe(false)
    expect(approval.consumeUserSettingCall({
      ...cleared,
      toolCallId: undefined,
    })).toBe(false)
    expect(approval.consumeUserSettingCall(cleared)).toBe(true)
    expect(approval.consumeUserSettingCall(cleared)).toBe(false)
  })

  it('never lifts the lock for a call that was asked or approved by hand',
    () => {
      const approval = createMemoryApproval({})
      const cleared = {
        toolCallId: 'call-1',
        toolName: 'memory_write',
        input,
      }

      approval.state.taint.add('web')
      approval.toolApproval(call('call-1', 'memory_write', input))
      approval.markApprovedByUser(cleared)

      expect(approval.consumeUserSettingCall(cleared)).toBe(false)
      expect(approval.isApprovedByUser(cleared)).toBe(true)
    })

  it('denies a Blocked memory tool, which the send does not offer', () => {
    const approval = createSendToolApproval({ state: createApprovalState() })

    approval.registerTools(
      { memory_forget: {} } as never,
      new Map(buildMemoryApprovalEntries({
        memory_write: 'blocked',
        memory_forget: 'ask',
      })),
    )

    expect(approval.toolApproval(call('call-1', 'memory_write', input)))
      .toMatchObject({ type: 'denied' })
    expect(approval.consumeUserSettingCall({
      toolCallId: 'call-1',
      toolName: 'memory_write',
      input,
    })).toBe(false)
  })
})
