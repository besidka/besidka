import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  GOOGLE_TOOL_OUTPUT_MAX_BYTES,
  googleEgressGrantKey,
} from '#shared/utils/google-tool-approvals'
import type { GoogleToolKind } from '#shared/utils/google-tool-approvals'
import {
  TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN,
  TOOL_APPROVAL_PAYLOAD_MAX_BYTES,
} from '#shared/utils/tool-approval-policy'
import {
  resolveReplayApproval,
  resolveToolApproval,
} from '~~/server/utils/tool-approval/policy'
import type {
  ToolApprovalDescriptor,
  ToolApprovalGrant,
} from '~~/server/utils/tool-approval/policy'
import {
  buildConnectorApprovalEntry,
  buildGoogleApprovalEntry,
  createSendToolApproval,
  presetApprovalTaint,
} from '~~/server/utils/tool-approval/send'
import {
  createApprovalState,
  recordTaint,
} from '~~/server/utils/tool-approval/state'
import type { ApprovalState } from '~~/server/utils/tool-approval/state'
import {
  GOOGLE_TOOL_ERROR_PERSISTED_TEXT,
  chatHoldsGoogleData,
  collectGoogleToolResultBodies,
  deleteGoogleToolResults,
  hasGoogleToolResult,
  loadGoogleToolResults,
  readGoogleChatGrantHashes,
  redactGoogleToolPartsForPersistence,
  stashGoogleToolResults,
} from '~~/server/utils/tool-approval/google'
import {
  deleteToolApprovalChatRecords,
  putToolApprovalResults,
  toolApprovalResultIdOf,
  toolApprovalResultKey,
} from '~~/server/utils/tool-approval/kv'
import {
  applyRememberGrants,
  buildResumedAssistantMessages,
  decideContinuation,
} from '~~/server/utils/tool-approval/continuation'
import type { ToolApprovalPendingRecord } from '~~/server/utils/tool-approval/kv'

const storeMocks = vi.hoisted(() => ({
  listConnectorChatSettings: vi.fn(async () => []),
  upsertConnectorChatSettings: vi.fn(async () => {}),
  listConnectorToolSettings: vi.fn(async () => []),
  upsertConnectorToolSettings: vi.fn(async () => {}),
}))

vi.mock('~~/server/utils/connectors/store', () => ({
  ...storeMocks,
  recordConnectorToolCall: vi.fn(),
  settleConnectorToolCall: vi.fn(),
}))

const chatSettingsMocks = vi.hoisted(() => ({
  addBesidkaChatGrant: vi.fn(async () => {}),
  readBesidkaChatSettings: vi.fn(async () => ({
    enabled: true,
    alwaysAllowTools: {} as Record<string, string>,
  })),
}))

vi.mock('~~/server/utils/besidka-tools/chat-settings', () => chatSettingsMocks)

const HASH = 'c'.repeat(64)
const OTHER_HASH = 'd'.repeat(64)
const GOOGLE_READ = 'google__drive_search'
const GOOGLE_WRITE = 'google__calendar_create_event'
const CONNECTOR_TOOL = 'mcp__linear__search_issues'
const CONNECTOR_ID = 'conn-linear'
const OWNER = {
  userId: 7,
  chatPublicId: 'chat-google',
  messagePublicId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
}

function createFakeKv() {
  const values = new Map<string, string>()

  return {
    values,
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value)
    }),
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    delete: vi.fn(async (key: string) => {
      values.delete(key)
    }),
  }
}

function logger() {
  return { set: vi.fn() }
}

function googleDescriptor(
  overrides: Partial<ToolApprovalDescriptor> = {},
): ToolApprovalDescriptor {
  return {
    family: 'google',
    access: 'read',
    toolName: GOOGLE_READ,
    definitionHash: HASH,
    destructiveHint: false,
    ...overrides,
  }
}

function connectorDescriptor(
  overrides: Partial<ToolApprovalDescriptor> = {},
): ToolApprovalDescriptor {
  return {
    family: 'connector',
    access: 'read',
    toolName: CONNECTOR_TOOL,
    connectorId: CONNECTOR_ID,
    definitionHash: HASH,
    destructiveHint: false,
    ...overrides,
  }
}

function grant(overrides: Partial<ToolApprovalGrant> = {}): ToolApprovalGrant {
  return {
    definitionHash: HASH,
    connectorId: null,
    toolName: GOOGLE_READ,
    ...overrides,
  }
}

function connectorGrant(
  overrides: Partial<ToolApprovalGrant> = {},
): ToolApprovalGrant {
  return grant({
    connectorId: CONNECTOR_ID,
    toolName: CONNECTOR_TOOL,
    ...overrides,
  })
}

function googleTainted(): ApprovalState {
  return recordTaint(createApprovalState(), 'google')
}

function googleToolPart(overrides: Record<string, unknown> = {}) {
  return {
    type: `tool-${GOOGLE_READ}`,
    toolCallId: 'call-google-1',
    state: 'output-available',
    input: { query: 'budget' },
    output: {
      references: [{
        id: 'file-1',
        kind: 'drive-file',
        title: 'Budget 2027',
        link: 'https://drive.google.com/file/d/file-1/view',
        date: '2026-11-20',
        secret: 'not kept',
      }],
      text: 'The full document body that must never reach D1.',
    },
    ...overrides,
  }
}

describe('Google approval family (rule 11)', () => {
  it('asks a Google read with Allow once and Allow in this chat', () => {
    const decision = resolveToolApproval({
      descriptor: googleDescriptor(),
      state: createApprovalState(),
      permissionMode: 'ask',
    })

    expect(decision.rule).toBe(11)
    expect(decision.status.type).toBe('user-approval')
    expect(decision.rememberOptions).toEqual(['once', 'chat'])
  })

  it('runs a Google read under a matching chat grant, whatever the taint',
    () => {
      const state = recordTaint(googleTainted(), 'web')
      const decision = resolveToolApproval({
        descriptor: googleDescriptor(),
        state,
        permissionMode: 'ask',
        chatGrant: grant(),
      })

      expect(decision.rule).toBe(11)
      expect(decision.status.type).toBe('not-applicable')
    })

  it('asks a Google read again after its definition changed', () => {
    const decision = resolveToolApproval({
      descriptor: googleDescriptor(),
      state: createApprovalState(),
      permissionMode: 'ask',
      chatGrant: grant({ definitionHash: OTHER_HASH }),
    })

    expect(decision.status.type).toBe('user-approval')
  })

  it('ignores an Always allow grant and the allow mode on a Google read',
    () => {
      const decision = resolveToolApproval({
        descriptor: googleDescriptor(),
        state: createApprovalState(),
        permissionMode: 'allow',
        alwaysGrant: grant(),
      })

      expect(decision.status.type).toBe('user-approval')
      expect(decision.rememberOptions).not.toContain('always')
    })

  it('asks a Google write with Allow once only, whatever grants it has',
    () => {
      const decision = resolveToolApproval({
        descriptor: googleDescriptor({
          access: 'write',
          toolName: GOOGLE_WRITE,
          destructiveHint: true,
        }),
        state: createApprovalState(),
        permissionMode: 'allow',
        alwaysGrant: grant({ toolName: GOOGLE_WRITE }),
        chatGrant: grant({ toolName: GOOGLE_WRITE }),
        isAlwaysGrantDefault: false,
      })

      expect(decision.rule).toBe(11)
      expect(decision.reason).toBe('always-ask')
      expect(decision.rememberOptions).toEqual(['once'])
    })

  it('treats a destructive Google read as a write', () => {
    const decision = resolveToolApproval({
      descriptor: googleDescriptor({ destructiveHint: true }),
      state: createApprovalState(),
      permissionMode: 'ask',
      chatGrant: grant(),
    })

    expect(decision.rememberOptions).toEqual(['once'])
  })

  it('still denies a Blocked Google tool', () => {
    const decision = resolveToolApproval({
      descriptor: googleDescriptor(),
      state: createApprovalState(),
      permissionMode: 'blocked',
    })

    expect(decision.status).toEqual({ type: 'denied', reason: 'blocked' })
  })

  it('never offers Always allow for any Google tool or access', () => {
    for (const access of ['read', 'write', 'delete', 'instructions'] as const) {
      for (const permissionMode of ['ask', 'allow'] as const) {
        const decision = resolveToolApproval({
          descriptor: googleDescriptor({ access }),
          state: googleTainted(),
          permissionMode,
          alwaysGrant: grant(),
        })

        expect(decision.rememberOptions, `${access} ${permissionMode}`)
          .not.toContain('always')
      }
    }
  })
})

describe('Google egress (rule 12)', () => {
  it('asks a connector read with an Always allow default after Google '
    + 'content', () => {
    const decision = resolveToolApproval({
      descriptor: connectorDescriptor(),
      state: googleTainted(),
      permissionMode: 'ask',
      alwaysGrant: connectorGrant(),
      isAlwaysGrantDefault: true,
    })

    expect(decision.rule).toBe(12)
    expect(decision.reason).toBe('google-egress')
    expect(decision.rememberOptions).toEqual(['once', 'chat'])
  })

  it('asks a connector tool the user always allowed or allowed in this '
    + 'chat', () => {
    const decision = resolveToolApproval({
      descriptor: connectorDescriptor({ access: 'write' }),
      state: googleTainted(),
      permissionMode: 'ask',
      alwaysGrant: connectorGrant(),
      chatGrant: connectorGrant(),
    })

    expect(decision.rule).toBe(12)
  })

  it('falls through to the ordinary rules with a Google egress grant', () => {
    const decision = resolveToolApproval({
      descriptor: connectorDescriptor(),
      state: googleTainted(),
      permissionMode: 'ask',
      alwaysGrant: connectorGrant(),
      isAlwaysGrantDefault: true,
      googleEgressGrant: connectorGrant(),
    })

    expect(decision.rule).toBe(6)
    expect(decision.status.type).toBe('not-applicable')
  })

  it('still asks an ungranted write with an egress grant', () => {
    const decision = resolveToolApproval({
      descriptor: connectorDescriptor({ access: 'write' }),
      state: googleTainted(),
      permissionMode: 'ask',
      googleEgressGrant: connectorGrant(),
    })

    expect(decision.rule).toBe(2)
    expect(decision.reason).toBe('untrusted-output')
  })

  it('still asks a send tool after Allow in this chat on the egress prompt',
    () => {
      const decision = resolveToolApproval({
        descriptor: connectorDescriptor({
          access: 'write',
          destructiveHint: true,
        }),
        state: googleTainted(),
        permissionMode: 'ask',
        googleEgressGrant: connectorGrant(),
      })

      expect(decision.status.type).toBe('user-approval')
      expect(decision.reason).not.toBe('google-egress')
    })

  it('does not take an egress grant of another connector', () => {
    const decision = resolveToolApproval({
      descriptor: connectorDescriptor(),
      state: googleTainted(),
      permissionMode: 'ask',
      alwaysGrant: connectorGrant(),
      googleEgressGrant: connectorGrant({ connectorId: 'other' }),
    })

    expect(decision.rule).toBe(12)
  })

  it('leaves connector calls without Google content as they were', () => {
    const decision = resolveToolApproval({
      descriptor: connectorDescriptor(),
      state: recordTaint(createApprovalState(), 'web'),
      permissionMode: 'ask',
      alwaysGrant: connectorGrant(),
      isAlwaysGrantDefault: true,
    })

    expect(decision.rule).toBe(6)
  })

  it('keeps Besidka tools on their own rules after Google content', () => {
    const decision = resolveToolApproval({
      descriptor: {
        family: 'besidka',
        access: 'read',
        toolName: 'besidka__list_chats',
        definitionHash: HASH,
        destructiveHint: false,
      },
      state: googleTainted(),
      permissionMode: 'allow',
    })

    expect(decision.rule).toBe(6)
  })

  it('makes an artifact write ask after Google content', () => {
    const decision = resolveToolApproval({
      descriptor: {
        family: 'native',
        access: 'write',
        toolName: 'create_artifact',
        destructiveHint: false,
        onlyConnectorOrSkillTaint: true,
      },
      state: googleTainted(),
      permissionMode: 'ask',
    })

    expect(decision.rule).toBe(2)
  })
})

describe('Google replay', () => {
  function pending(overrides: Record<string, unknown> = {}) {
    return {
      family: 'google' as const,
      access: 'read' as const,
      toolName: GOOGLE_READ,
      connectorId: null,
      definitionHash: HASH,
      ...overrides,
    }
  }

  it('accepts an approved Google call without a connector id', () => {
    const decision = resolveReplayApproval({
      descriptor: googleDescriptor(),
      pending: pending(),
      state: createApprovalState(),
      permissionMode: 'ask',
    })

    expect(decision.denialReason).toBeNull()
  })

  it.each([
    ['a changed hash', { definitionHash: OTHER_HASH }],
    ['a changed access', { access: 'write' }],
    ['a connector id', { connectorId: CONNECTOR_ID }],
  ])('denies a Google call with %s', (_name, overrides) => {
    const decision = resolveReplayApproval({
      descriptor: googleDescriptor(),
      pending: pending(overrides),
      state: createApprovalState(),
      permissionMode: 'ask',
    })

    expect(decision.denialReason).toBe('definition-drifted')
  })

  it('denies a pending record whose family this deploy does not know', () => {
    const decision = resolveReplayApproval({
      descriptor: googleDescriptor(),
      pending: pending({ family: null }),
      state: createApprovalState(),
      permissionMode: 'ask',
    })

    expect(decision.denialReason).toBe('invalid-input')
  })

  it('denies a Google call once the built-in call cap is spent', () => {
    const state = createApprovalState()

    state.counters.builtInCalls = TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN

    const decision = resolveReplayApproval({
      descriptor: googleDescriptor(),
      pending: pending(),
      state,
      permissionMode: 'ask',
    })

    expect(decision.denialReason).toBe('over-cap')
  })
})

describe('Google tools in a send', () => {
  function googleEntry(kind: GoogleToolKind = 'read', chatGrantHash?: string) {
    return buildGoogleApprovalEntry({
      toolName: kind === 'read' ? GOOGLE_READ : GOOGLE_WRITE,
      kind,
      definitionHash: HASH,
      summary: 'Besidka wants to search Google Drive',
      ...(chatGrantHash ? { chatGrantHash } : {}),
    })
  }

  it('refuses a Google tool whose name lacks the google__ prefix', () => {
    expect(() => buildGoogleApprovalEntry({
      toolName: 'drive_search',
      kind: 'read',
      definitionHash: HASH,
      summary: 'Search',
    })).toThrow()
  })

  it('treats a Google tool registered with an unknown kind as a write', () => {
    const entry = buildGoogleApprovalEntry({
      toolName: GOOGLE_READ,
      kind: 'list' as GoogleToolKind,
      definitionHash: HASH,
      summary: 'Search',
      chatGrantHash: HASH,
    })

    expect(entry.descriptor.access).toBe('write')
    expect(entry.userGrants?.chat).toBeNull()
  })

  it('never lets an unregistered google__ tool run as a native write', () => {
    const approval = createSendToolApproval({ state: createApprovalState() })

    approval.registerTools({ google__gmail_send: {} } as never)

    const entry = approval.entries.get('google__gmail_send')
    const status = approval.toolApproval({
      toolCall: {
        toolCallId: 'call-unregistered',
        toolName: 'google__gmail_send',
        input: { to: 'someone@example.com' },
      },
    })

    expect(entry?.descriptor.family).toBe('google')
    expect(entry?.descriptor.access).toBe('write')
    expect(status).toEqual({ type: 'user-approval', reason: 'always-ask' })
    expect(approval.getPendingDecision('call-unregistered')?.decision
      .rememberOptions).toEqual(['once'])
  })

  it('records Google taint, a tool read and a built-in call when a granted '
    + 'read runs', () => {
    const approval = createSendToolApproval({ state: createApprovalState() })

    approval.registerTools(undefined, new Map([
      [GOOGLE_READ, googleEntry('read', HASH)],
    ]))

    const status = approval.toolApproval({
      toolCall: { toolCallId: 'call-1', toolName: GOOGLE_READ, input: {} },
    })

    expect(status).toBe('not-applicable')
    expect(approval.state.taint.has('google')).toBe(true)
    expect(approval.state.toolReadSources.has('google')).toBe(true)
    expect(approval.state.counters.builtInCalls).toBe(1)
    expect(approval.getGrantScope('call-1')).toBe('chat')
  })

  it('withholds web search after a Google read', () => {
    const approval = createSendToolApproval({ state: createApprovalState() })
    const tools = { web_search: { type: 'provider' } } as never

    approval.registerTools(tools, new Map([
      [GOOGLE_READ, googleEntry('read', HASH)],
    ]))

    expect(approval.listWithheldProviderTools(tools)).toEqual([])

    approval.toolApproval({
      toolCall: { toolCallId: 'call-1', toolName: GOOGLE_READ, input: {} },
    })

    expect(approval.listWithheldProviderTools(tools)).toEqual(['web_search'])
  })

  it('asks a later connector call for the Google egress grant', () => {
    const approval = createSendToolApproval({ state: createApprovalState() })
    const connector = buildConnectorApprovalEntry({
      exposedName: CONNECTOR_TOOL,
      connectorId: CONNECTOR_ID,
      connectorTitle: 'Linear',
      connectorHost: 'mcp.linear.app',
      remoteToolName: 'search_issues',
      definitionHash: HASH,
      annotations: { readOnlyHint: true },
      isAlwaysDefault: true,
      grantHashes: { always: HASH, chat: HASH },
    })

    approval.registerTools(undefined, new Map([
      [GOOGLE_READ, googleEntry('read', HASH)],
      [CONNECTOR_TOOL, connector],
    ]))
    approval.toolApproval({
      toolCall: { toolCallId: 'call-1', toolName: GOOGLE_READ, input: {} },
      messages: [],
    } as never)

    const status = approval.toolApproval({
      toolCall: { toolCallId: 'call-2', toolName: CONNECTOR_TOOL, input: {} },
      messages: [{ role: 'tool' }],
    } as never)

    expect(status).toEqual({ type: 'user-approval', reason: 'google-egress' })
  })

  it('lets the connector call run with its egress grant', () => {
    const approval = createSendToolApproval({ state: googleTainted() })
    const connector = buildConnectorApprovalEntry({
      exposedName: CONNECTOR_TOOL,
      connectorId: CONNECTOR_ID,
      connectorTitle: 'Linear',
      connectorHost: 'mcp.linear.app',
      remoteToolName: 'search_issues',
      definitionHash: HASH,
      annotations: { readOnlyHint: true },
      isAlwaysDefault: true,
      grantHashes: { always: HASH, chat: null, googleEgress: HASH },
    })

    approval.registerTools(undefined, new Map([[CONNECTOR_TOOL, connector]]))

    expect(approval.toolApproval({
      toolCall: { toolCallId: 'call-2', toolName: CONNECTOR_TOOL, input: {} },
    })).toBe('not-applicable')
  })

  it('guards the execute of a Google tool behind a cleared call', async () => {
    const approval = createSendToolApproval({ state: createApprovalState() })
    const execute = vi.fn(async () => ({ references: [] }))
    const tools = { [GOOGLE_READ]: { execute } } as never

    approval.registerTools(tools, new Map([
      [GOOGLE_READ, googleEntry('read', HASH)],
    ]))

    const guarded = approval.guardNativeWrites(tools) as unknown as Record<
      string,
      { execute: (input: unknown, options: unknown) => Promise<unknown> }
    >

    await expect(async () => {
      await guarded[GOOGLE_READ]!.execute({}, { toolCallId: 'call-x' })
    }).rejects.toThrow()
    expect(execute).not.toHaveBeenCalled()

    approval.toolApproval({
      toolCall: { toolCallId: 'call-1', toolName: GOOGLE_READ, input: {} },
    })
    await guarded[GOOGLE_READ]!.execute({}, { toolCallId: 'call-1' })

    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('presets Google taint for a chat that already holds Google data', () => {
    const state = createApprovalState()

    presetApprovalTaint(state, {
      requestedTools: [],
      holdsUntrustedKnowledge: false,
      holdsArtifactContext: false,
      holdsSkillText: false,
      holdsPastChatExcerpts: false,
      isBranchedFromShare: false,
      holdsGoogleData: chatHoldsGoogleData([
        { parts: [{ type: 'text', text: 'hi' }] },
        {
          parts: redactGoogleToolPartsForPersistence(
            [googleToolPart()] as never,
          ),
        },
      ]),
    })

    expect(state.taint.has('google')).toBe(true)
  })

  it('exports the output cap for tool authors', () => {
    expect(GOOGLE_TOOL_OUTPUT_MAX_BYTES).toBe(TOOL_APPROVAL_PAYLOAD_MAX_BYTES)
  })
})

describe('references-only persistence', () => {
  it('rewrites a Google result in place to its references', () => {
    const textPart = { type: 'text', text: 'Here is what I found.' }
    const parts = [textPart, googleToolPart()] as unknown as UIMessage['parts']
    const redacted = redactGoogleToolPartsForPersistence(parts)

    expect(redacted).toHaveLength(parts.length)
    expect(redacted[0]).toBe(textPart)
    expect(redacted[1]).toMatchObject({
      type: `tool-${GOOGLE_READ}`,
      toolCallId: 'call-google-1',
      state: 'output-available',
      output: {
        bodyRemoved: true,
        references: [{
          id: 'file-1',
          kind: 'drive-file',
          title: 'Budget 2027',
          link: 'https://drive.google.com/file/d/file-1/view',
          date: '2026-11-20',
        }],
      },
    })
    expect(JSON.stringify(redacted)).not.toContain('document body')
    expect(JSON.stringify(redacted)).not.toContain('not kept')
    expect(hasGoogleToolResult(redacted)).toBe(true)
  })

  it('keeps no references from an unexpected shape and drops unsafe links',
    () => {
      const [plain, unsafe] = redactGoogleToolPartsForPersistence([
        googleToolPart({ output: 'raw body text' }),
        googleToolPart({
          type: 'dynamic-tool',
          toolName: GOOGLE_READ,
          output: {
            references: [{ id: 'x', link: 'javascript:alert(1)' }, { id: '' }],
          },
        }),
      ] as never) as unknown as Array<{ output: unknown }>

      expect(plain!.output).toEqual({ references: [], bodyRemoved: true })
      expect(unsafe!.output).toEqual({
        references: [{ id: 'x' }],
        bodyRemoved: true,
      })
    })

  it('replaces a Google error text with one fixed sentence', () => {
    const [redacted] = redactGoogleToolPartsForPersistence([
      googleToolPart({
        state: 'output-error',
        output: undefined,
        errorText: 'Quota exceeded for the file "Salaries"',
      }),
    ] as never) as unknown as Array<{ errorText: string }>

    expect(redacted!.errorText).toBe(GOOGLE_TOOL_ERROR_PERSISTED_TEXT)
  })

  it('is idempotent and leaves other tool parts alone', () => {
    const connectorPart = {
      type: 'dynamic-tool',
      toolName: CONNECTOR_TOOL,
      toolCallId: 'call-c',
      state: 'output-available',
      output: 'connector text',
    }
    const once = redactGoogleToolPartsForPersistence(
      [googleToolPart(), connectorPart] as never,
    )
    const twice = redactGoogleToolPartsForPersistence(once)

    expect(twice).toEqual(once)
    expect(twice[1]).toBe(connectorPart)
  })

  it('collects only bodies that were not removed yet', () => {
    const redacted = redactGoogleToolPartsForPersistence([
      googleToolPart({ toolCallId: 'old' }),
    ] as never)
    const bodies = collectGoogleToolResultBodies([
      ...redacted,
      googleToolPart({ toolCallId: 'new' }),
      googleToolPart({
        toolCallId: 'failed',
        state: 'output-error',
        errorText: 'Drive said no',
      }),
    ])

    expect(bodies.map(body => body.toolCallId)).toEqual(['new', 'failed'])
    expect(bodies[1]).toMatchObject({ isError: true, output: 'Drive said no' })
  })
})

describe('the KV stash of a paused turn', () => {
  it('stores bodies under hashed, indexed keys and loads them back', async () => {
    const kv = createFakeKv()
    const parts = [googleToolPart()]

    await stashGoogleToolResults({
      kv: kv as never,
      owner: OWNER,
      parts,
      logger: logger(),
    })

    const resultId = await toolApprovalResultIdOf(
      OWNER.messagePublicId,
      'call-google-1',
    )

    expect(kv.values.has(toolApprovalResultKey(resultId))).toBe(true)
    expect(kv.put).toHaveBeenCalledWith(
      toolApprovalResultKey(resultId),
      expect.any(String),
      { expirationTtl: 24 * 60 * 60 },
    )

    const loaded = await loadGoogleToolResults({
      kv: kv as never,
      owner: OWNER,
      parts: redactGoogleToolPartsForPersistence(parts as never),
      logger: logger(),
    })

    expect(loaded.get('call-google-1')).toEqual({
      isError: false,
      output: googleToolPart().output,
    })
  })

  it('accepts tool call ids that are not approval ids', async () => {
    const kv = createFakeKv()
    const toolCallId = 'functions.drive_search:0'

    await stashGoogleToolResults({
      kv: kv as never,
      owner: OWNER,
      parts: [googleToolPart({ toolCallId })],
      logger: logger(),
    })

    const loaded = await loadGoogleToolResults({
      kv: kv as never,
      owner: OWNER,
      parts: [googleToolPart({ toolCallId })],
      logger: logger(),
    })

    expect(loaded.has(toolCallId)).toBe(true)
  })

  it('ignores a stashed record of another user or message', async () => {
    const kv = createFakeKv()
    const resultId = await toolApprovalResultIdOf(
      OWNER.messagePublicId,
      'call-google-1',
    )

    await putToolApprovalResults(kv as never, [{
      resultId,
      record: {
        version: 1,
        userId: 99,
        chatPublicId: OWNER.chatPublicId,
        messagePublicId: OWNER.messagePublicId,
        toolCallId: 'call-google-1',
        isError: false,
        output: 'someone else',
        recordedAt: 1,
      },
    }])

    const loaded = await loadGoogleToolResults({
      kv: kv as never,
      owner: OWNER,
      parts: [googleToolPart()],
      logger: logger(),
    })

    expect(loaded.size).toBe(0)
  })

  it('degrades to the references when the stash is missing or broken',
    async () => {
      const kv = createFakeKv()

      kv.get.mockRejectedValueOnce(new Error('KV down'))

      const loaded = await loadGoogleToolResults({
        kv: kv as never,
        owner: OWNER,
        parts: [googleToolPart(), googleToolPart({ toolCallId: 'call-2' })],
        logger: logger(),
      })

      expect(loaded.size).toBe(0)
    })

  it('stores an output over the cap as a marker', async () => {
    const kv = createFakeKv()

    await stashGoogleToolResults({
      kv: kv as never,
      owner: OWNER,
      parts: [googleToolPart({
        output: {
          references: [],
          text: 'x'.repeat(GOOGLE_TOOL_OUTPUT_MAX_BYTES + 1),
        },
      })],
      logger: logger(),
    })

    const loaded = await loadGoogleToolResults({
      kv: kv as never,
      owner: OWNER,
      parts: [googleToolPart()],
      logger: logger(),
    })

    expect(String(loaded.get('call-google-1')?.output))
      .toMatch(/^\[Output omitted:/)
  })

  it('is removed by a finished continuation', async () => {
    const kv = createFakeKv()
    const parts = [googleToolPart()]

    await stashGoogleToolResults({
      kv: kv as never,
      owner: OWNER,
      parts,
      logger: logger(),
    })
    await deleteGoogleToolResults({
      kv: kv as never,
      messagePublicId: OWNER.messagePublicId,
      parts,
      logger: logger(),
    })

    const resultId = await toolApprovalResultIdOf(
      OWNER.messagePublicId,
      'call-google-1',
    )

    expect(kv.values.has(toolApprovalResultKey(resultId))).toBe(false)
  })

  it('is removed with the chat records (new message, chat delete, purge)',
    async () => {
      const kv = createFakeKv()

      await stashGoogleToolResults({
        kv: kv as never,
        owner: OWNER,
        parts: [googleToolPart(), googleToolPart({ toolCallId: 'call-2' })],
        logger: logger(),
      })
      await deleteToolApprovalChatRecords(kv as never, OWNER.chatPublicId)

      const leftover = [...kv.values.keys()].filter((key) => {
        return key.startsWith('tool-approval:result:')
      })

      expect(leftover).toEqual([])
    })

  it('writes the chat index once for every stashed body', async () => {
    const kv = createFakeKv()

    await stashGoogleToolResults({
      kv: kv as never,
      owner: OWNER,
      parts: [
        googleToolPart(),
        googleToolPart({ toolCallId: 'call-2' }),
        googleToolPart({ toolCallId: 'call-3' }),
      ],
      logger: logger(),
    })

    const indexWrites = kv.put.mock.calls.filter(([key]) => {
      return key === `tool-approval:chat:${OWNER.chatPublicId}`
    })

    expect(indexWrites).toHaveLength(1)
  })

  it('logs counts only, never a body', async () => {
    const kv = createFakeKv()
    const log = logger()

    await stashGoogleToolResults({
      kv: kv as never,
      owner: OWNER,
      parts: [googleToolPart()],
      logger: log,
    })

    expect(JSON.stringify(log.set.mock.calls)).not.toContain('document body')
  })
})

describe('the continuation of a paused Google turn', () => {
  function decision(record: Partial<ToolApprovalPendingRecord> = {}) {
    return {
      approvalId: 'approval-1',
      toolCallId: 'call-connector',
      toolName: CONNECTOR_TOOL,
      approved: true,
      reason: undefined,
      remember: 'once' as const,
      denialReason: null,
      record: {
        version: 1,
        userId: OWNER.userId,
        chatPublicId: OWNER.chatPublicId,
        messagePublicId: OWNER.messagePublicId,
        toolCallId: 'call-connector',
        family: 'connector',
        access: 'read',
        toolName: CONNECTOR_TOOL,
        connectorId: CONNECTOR_ID,
        definitionHash: HASH,
        input: {},
        signature: 'sig',
        reason: 'default',
        rememberOptions: ['once', 'chat', 'always'],
        summary: 'Search',
        auditCallId: null,
        snapshot: {
          model: 'claude-haiku-4-5',
          gateway: null,
          reasoning: 'off',
          connectorIds: [],
        },
        ...record,
      } as ToolApprovalPendingRecord,
    }
  }

  it('gives stashed bodies back to the model and keeps the stored parts',
    () => {
      const stored = redactGoogleToolPartsForPersistence(
        [googleToolPart()] as never,
      )
      const awaiting = {
        type: `tool-${CONNECTOR_TOOL}`,
        toolCallId: 'call-connector',
        state: 'approval-requested',
        input: {},
        approval: { id: 'approval-1' },
      }
      const { modelMessage, storedMessage } = buildResumedAssistantMessages({
        messageId: OWNER.messagePublicId,
        parts: [...stored, awaiting],
        decisions: [decision()],
        stashedResults: new Map([['call-google-1', {
          isError: false,
          output: googleToolPart().output,
        }]]),
      })

      expect(modelMessage.parts[0]).toMatchObject({
        output: googleToolPart().output,
      })
      expect(storedMessage.parts[0]).toBe(stored[0])
      expect(JSON.stringify(storedMessage.parts)).not.toContain('document body')
    })

  it('counts an approved Google call against the built-in cap', () => {
    const entry = buildGoogleApprovalEntry({
      toolName: GOOGLE_READ,
      kind: 'read',
      definitionHash: HASH,
      summary: 'Search',
    })
    const state = createApprovalState()

    state.counters.builtInCalls = TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN - 1

    const record = decision({
      family: 'google',
      toolName: GOOGLE_READ,
      connectorId: null,
      toolCallId: 'call-g',
    }).record
    const decisions = decideContinuation({
      answers: [
        {
          response: {
            approvalId: 'approval-aaaaaaaa',
            approved: true,
            remember: 'once',
          },
          record,
        },
        {
          response: {
            approvalId: 'approval-bbbbbbbb',
            approved: true,
            remember: 'once',
          },
          record: { ...record, toolCallId: 'call-h' },
        },
      ],
      entries: new Map([[GOOGLE_READ, entry]]),
      state,
    })

    expect(decisions.map(item => item.approved)).toEqual([true, false])
    expect(decisions[1]!.denialReason).toBe('over-cap')
  })

  it('stores Allow in this chat for a Google read under its google__ key',
    async () => {
      chatSettingsMocks.addBesidkaChatGrant.mockClear()

      await applyRememberGrants({
        db: {} as never,
        userId: OWNER.userId,
        chatPublicId: OWNER.chatPublicId,
        decisions: [{
          ...decision({
            family: 'google',
            access: 'read',
            toolName: GOOGLE_READ,
            connectorId: null,
          }),
          toolName: GOOGLE_READ,
          remember: 'chat',
        }],
        entries: new Map([[GOOGLE_READ, buildGoogleApprovalEntry({
          toolName: GOOGLE_READ,
          kind: 'read',
          definitionHash: HASH,
          summary: 'Search',
        })]]),
        logger: logger() as never,
      })

      expect(chatSettingsMocks.addBesidkaChatGrant).toHaveBeenCalledWith(
        {},
        OWNER.userId,
        OWNER.chatPublicId,
        { toolName: GOOGLE_READ, definitionHash: HASH },
      )
    })

  it('never stores a grant for a Google write', async () => {
    chatSettingsMocks.addBesidkaChatGrant.mockClear()

    for (const remember of ['chat', 'always'] as const) {
      await applyRememberGrants({
        db: {} as never,
        userId: OWNER.userId,
        chatPublicId: OWNER.chatPublicId,
        decisions: [{
          ...decision({
            family: 'google',
            access: 'write',
            toolName: GOOGLE_WRITE,
            connectorId: null,
          }),
          toolName: GOOGLE_WRITE,
          remember,
        }],
        entries: new Map([[GOOGLE_WRITE, buildGoogleApprovalEntry({
          toolName: GOOGLE_WRITE,
          kind: 'write',
          definitionHash: HASH,
          summary: 'Create an event',
        })]]),
        logger: logger() as never,
      })
    }

    expect(chatSettingsMocks.addBesidkaChatGrant).not.toHaveBeenCalled()
    expect(storeMocks.upsertConnectorToolSettings).not.toHaveBeenCalled()
  })

  it('stores only the egress key for Allow in this chat on an egress prompt',
    async () => {
      storeMocks.upsertConnectorChatSettings.mockClear()

      await applyRememberGrants({
        db: {} as never,
        userId: OWNER.userId,
        chatPublicId: OWNER.chatPublicId,
        decisions: [{
          ...decision({ reason: 'google-egress' }),
          remember: 'chat',
        }],
        entries: new Map([[CONNECTOR_TOOL, buildConnectorApprovalEntry({
          exposedName: CONNECTOR_TOOL,
          connectorId: CONNECTOR_ID,
          connectorTitle: 'Linear',
          connectorHost: 'mcp.linear.app',
          remoteToolName: 'search_issues',
          definitionHash: HASH,
          annotations: { readOnlyHint: true },
        })]]),
        logger: logger() as never,
      })

      expect(storeMocks.upsertConnectorChatSettings).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          connectorId: CONNECTOR_ID,
          alwaysAllowTools: { [googleEgressGrantKey(CONNECTOR_TOOL)]: HASH },
        }),
      )
    })
})

describe('readGoogleChatGrantHashes', () => {
  it('returns only the google__ grants of the chat', async () => {
    chatSettingsMocks.readBesidkaChatSettings.mockResolvedValueOnce({
      enabled: true,
      alwaysAllowTools: {
        [GOOGLE_READ]: HASH,
        besidka__list_chats: OTHER_HASH,
        run_skill_scripts: OTHER_HASH,
      },
    })

    expect(await readGoogleChatGrantHashes(
      {} as never,
      OWNER.userId,
      OWNER.chatPublicId,
      logger(),
    )).toEqual({ [GOOGLE_READ]: HASH })
  })

  it('reads no grants when the settings cannot be read', async () => {
    chatSettingsMocks.readBesidkaChatSettings.mockRejectedValueOnce(
      new Error('D1 down'),
    )

    expect(await readGoogleChatGrantHashes(
      {} as never,
      OWNER.userId,
      OWNER.chatPublicId,
      logger(),
    )).toEqual({})
  })
})
