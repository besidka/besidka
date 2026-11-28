import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_ALWAYS_ALLOW_READS_PER_MESSAGE,
  GOOGLE_ALWAYS_ALLOW_WRITES_PER_MESSAGE,
  GOOGLE_TOOL_CATALOG,
  isGoogleToolAlwaysAllowable,
} from '#shared/utils/google-tool-catalog'
import {
  resolveReplayApproval,
  resolveToolApproval,
} from '~~/server/utils/tool-approval/policy'
import type {
  ToolApprovalDescriptor,
  ToolApprovalGrant,
} from '~~/server/utils/tool-approval/policy'
import {
  buildGoogleApprovalEntry as buildStrictGoogleApprovalEntry,
  countGrantRuns,
  createSendToolApproval,
} from '~~/server/utils/tool-approval/send'
import type { SendToolEntry } from '~~/server/utils/tool-approval/send'
import {
  createApprovalState,
  recordTaint,
} from '~~/server/utils/tool-approval/state'
import {
  GOOGLE_RUN_NO_GATE_TEXT,
} from '~~/server/utils/tool-approval/google-run-gate'
import type {
  GoogleRunGate,
} from '~~/server/utils/tool-approval/google-run-gate'

const HASH = 'a'.repeat(64)

const READ_CAP = GOOGLE_ALWAYS_ALLOW_READS_PER_MESSAGE

const WRITE_CAP = GOOGLE_ALWAYS_ALLOW_WRITES_PER_MESSAGE

const ALLOWABLE = GOOGLE_TOOL_CATALOG.filter((tool) => {
  return isGoogleToolAlwaysAllowable(tool)
})

const NOT_ALLOWABLE = GOOGLE_TOOL_CATALOG.filter((tool) => {
  return !isGoogleToolAlwaysAllowable(tool)
})

const SEARCH = 'google__gmail_search'
const THREAD = 'google__gmail_read_thread'
const DRAFT = 'google__gmail_create_draft'
const FOLDER = 'google__drive_create_folder'
const RENAME = 'google__drive_rename'
const MOVE = 'google__drive_move'
const EVENT = 'google__calendar_create_event'

function descriptor(
  toolName: string,
  kind: 'read' | 'write',
): ToolApprovalDescriptor {
  return {
    family: 'google',
    access: kind,
    toolName,
    definitionHash: HASH,
    destructiveHint: kind === 'write',
  }
}

function grant(toolName: string): ToolApprovalGrant {
  return { definitionHash: HASH, connectorId: null, toolName }
}

function entryOf(
  toolName: string,
  kind: 'read' | 'write',
  mode: 'allow' | 'ask' = 'allow',
  hasChatGrant = false,
): SendToolEntry {
  const entry = buildStrictGoogleApprovalEntry({
    toolName,
    kind,
    definitionHash: HASH,
    summary: `Run ${toolName}`,
    toolApprovalsActive: true,
    chatGrantHash: hasChatGrant ? HASH : null,
  })

  return { ...entry, permissionMode: mode }
}

function call(toolCallId: string, toolName: string, input: unknown = {}) {
  return { toolCall: { toolCallId, toolName, input } }
}

function createApproval(
  entries: SendToolEntry[],
  options: {
    priorAlwaysGrantRuns?: ReadonlyMap<string, number>
  } = {},
) {
  const approval = createSendToolApproval({
    state: createApprovalState(),
    ...options,
  })

  approval.registerTools(
    Object.fromEntries(entries.map(entry => [entry.descriptor.toolName, {}])),
    new Map(entries.map(entry => [entry.descriptor.toolName, entry])),
  )

  return approval
}

describe('rule 11 for a tool set to Always allow', () => {
  it.each(ALLOWABLE.map(tool => [tool.name, tool.kind] as const))(
    'runs %s without asking and marks the grant as always',
    (toolName, kind) => {
      const decision = resolveToolApproval({
        descriptor: descriptor(toolName, kind),
        state: createApprovalState(),
        permissionMode: 'allow',
      })

      expect(decision.status.type).toBe('not-applicable')
      expect(decision.rule).toBe(11)
      expect(decision.grant).toBe('always')
      expect(decision.rememberOptions).toEqual([])
    },
  )

  it.each(NOT_ALLOWABLE.map(tool => [tool.name, tool.kind] as const))(
    'still asks for %s, a tool of Besidka\'s client, whatever its mode',
    (toolName, kind) => {
      const decision = resolveToolApproval({
        descriptor: descriptor(toolName, kind),
        state: createApprovalState(),
        permissionMode: 'allow',
      })

      expect(decision.status.type).toBe('user-approval')
      expect(decision.rule).toBe(11)
      expect(decision.grant).toBeUndefined()
      expect(decision.rememberOptions).not.toContain('always')
    },
  )

  it('never lets Always allow cover a name outside the catalog', () => {
    const decision = resolveToolApproval({
      descriptor: descriptor('google__list_files', 'write'),
      state: createApprovalState(),
      permissionMode: 'allow',
    })

    expect(decision.status.type).toBe('user-approval')
    expect(decision.rememberOptions).toEqual(['once'])
  })

  it('lets the user\'s grant win over a once-only read', () => {
    for (const toolName of [THREAD, 'google__drive_read_found_file']) {
      const asked = resolveToolApproval({
        descriptor: descriptor(toolName, 'read'),
        state: createApprovalState(),
        permissionMode: 'ask',
        chatGrant: grant(toolName),
      })
      const allowed = resolveToolApproval({
        descriptor: descriptor(toolName, 'read'),
        state: createApprovalState(),
        permissionMode: 'allow',
      })

      expect(asked.status.type).toBe('user-approval')
      expect(asked.rememberOptions).toEqual(['once'])
      expect(allowed.status.type).toBe('not-applicable')
      expect(allowed.grant).toBe('always')
    }
  })

  it('runs after taint of every kind, because only the user\'s grant matters',
    () => {
      let state = createApprovalState()

      for (const kind of [
        'web',
        'connector',
        'google',
        'file',
        'skill',
        'shared-branch',
      ] as const) {
        state = recordTaint(state, kind)
      }

      for (const [toolName, kind] of [
        [SEARCH, 'read'],
        [DRAFT, 'write'],
        [EVENT, 'write'],
      ] as const) {
        expect(resolveToolApproval({
          descriptor: descriptor(toolName, kind),
          state,
          permissionMode: 'allow',
        }).status.type, toolName).toBe('not-applicable')
      }
    })

  it('denies a Blocked tool before anything else, and invalid input too',
    () => {
      expect(resolveToolApproval({
        descriptor: descriptor(SEARCH, 'read'),
        state: createApprovalState(),
        permissionMode: 'blocked',
        chatGrant: grant(SEARCH),
      }).status).toEqual({ type: 'denied', reason: 'blocked' })
      expect(resolveToolApproval({
        descriptor: { ...descriptor(SEARCH, 'read'), toolName: '' },
        state: createApprovalState(),
        permissionMode: 'allow',
      }).status).toEqual({ type: 'denied', reason: 'invalid-input' })
      expect(resolveToolApproval({
        descriptor: descriptor(SEARCH, 'read'),
        state: createApprovalState(),
        permissionMode: 'sometimes' as never,
      }).status).toEqual({ type: 'denied', reason: 'invalid-input' })
    })

  it('leaves a tool set to Needs approval asking exactly as before', () => {
    const read = resolveToolApproval({
      descriptor: descriptor(SEARCH, 'read'),
      state: createApprovalState(),
      permissionMode: 'ask',
    })
    const write = resolveToolApproval({
      descriptor: descriptor(DRAFT, 'write'),
      state: createApprovalState(),
      permissionMode: 'ask',
      alwaysGrant: grant(DRAFT),
      chatGrant: grant(DRAFT),
    })

    expect(read.rememberOptions).toEqual(['once', 'chat'])
    expect(read.grant).toBeUndefined()
    expect(write.reason).toBe('always-ask')
    expect(write.rememberOptions).toEqual(['once'])
  })

  it('keeps the replay denial: a tool Blocked after approval is denied, '
    + 'and one set to Always allow still replays', () => {
    const pending = {
      family: 'google' as const,
      access: 'read' as const,
      toolName: SEARCH,
      definitionHash: HASH,
    }
    const state = createApprovalState()

    expect(resolveReplayApproval({
      descriptor: descriptor(SEARCH, 'read'),
      pending,
      state,
      permissionMode: 'blocked',
    }).denialReason).toBe('blocked')
    expect(resolveReplayApproval({
      descriptor: descriptor(SEARCH, 'read'),
      pending,
      state,
      permissionMode: 'allow',
    }).denialReason).toBeNull()
  })
})

describe('Always allow in a send', () => {
  it('runs a read without asking and writes the always marker', () => {
    const approval = createApproval([entryOf(SEARCH, 'read')])

    expect(approval.toolApproval(call('c1', SEARCH))).toBe('not-applicable')
    expect(approval.getGrantScope('c1')).toBe('always')
  })

  it('writes the always marker for a write too, and no marker for a call '
    + 'that asks', () => {
    const approval = createApproval([
      entryOf(DRAFT, 'write'),
      entryOf(EVENT, 'write', 'ask'),
    ])

    expect(approval.toolApproval(call('c1', DRAFT))).toBe('not-applicable')
    expect(approval.getGrantScope('c1')).toBe('always')
    expect(approval.toolApproval(call('c2', EVENT)))
      .toEqual({ type: 'user-approval', reason: 'always-ask' })
    expect(approval.getGrantScope('c2')).toBeNull()
  })

  it('runs after google taint, and records the taint of a read it ran', () => {
    const approval = createApproval([entryOf(THREAD, 'read')])

    expect(approval.toolApproval(call('c1', THREAD))).toBe('not-applicable')
    expect(approval.state.taint.has('google')).toBe(true)
    expect(approval.toolApproval(call('c2', THREAD))).toBe('not-applicable')
  })

  it('caps the reads of one tool in a message, then asks again', () => {
    const approval = createApproval([entryOf(SEARCH, 'read')])

    for (let index = 0; index < READ_CAP; index++) {
      expect(approval.toolApproval(call(`c${index}`, SEARCH)))
        .toBe('not-applicable')
    }

    expect(approval.toolApproval(call('over', SEARCH)))
      .toEqual({ type: 'user-approval', reason: 'default' })
    expect(approval.getPendingDecision('over')?.decision.rememberOptions)
      .toEqual(['once', 'chat'])
    expect(approval.getGrantScope('over')).toBeNull()
  })

  it('asks again past the read cap even when the tool also has a chat '
    + 'grant, so the cap is the cap', () => {
    const approval = createApproval([entryOf(SEARCH, 'read', 'allow', true)])

    for (let index = 0; index < READ_CAP; index++) {
      expect(approval.toolApproval(call(`c${index}`, SEARCH)))
        .toBe('not-applicable')
      expect(approval.getGrantScope(`c${index}`)).toBe('always')
    }

    expect(approval.toolApproval(call('over', SEARCH)))
      .toEqual({ type: 'user-approval', reason: 'default' })
    expect(approval.getPendingDecision('over')?.decision.rememberOptions)
      .toEqual(['once', 'chat'])
    expect(approval.getGrantScope('over')).toBeNull()
  })

  it('asks again past the write cap even with a chat grant on the tool', () => {
    const approval = createApproval([entryOf(FOLDER, 'write', 'allow', true)])

    for (let index = 0; index < WRITE_CAP; index++) {
      expect(approval.toolApproval(call(`f${index}`, FOLDER)))
        .toBe('not-applicable')
    }

    expect(approval.toolApproval(call('over', FOLDER)))
      .toEqual({ type: 'user-approval', reason: 'always-ask' })
  })

  it('counts the reads of each tool on its own', () => {
    const approval = createApproval([
      entryOf(SEARCH, 'read'),
      entryOf('google__calendar_list_events', 'read'),
    ])

    for (let index = 0; index < READ_CAP; index++) {
      approval.toolApproval(call(`s${index}`, SEARCH))
    }

    expect(approval.toolApproval(call('e1', 'google__calendar_list_events')))
      .toBe('not-applicable')
  })

  it('asks for a once-only read past its cap with Allow once only', () => {
    const approval = createApproval([entryOf(THREAD, 'read')])

    for (let index = 0; index < READ_CAP; index++) {
      expect(approval.toolApproval(call(`t${index}`, THREAD)))
        .toBe('not-applicable')
    }

    expect(approval.toolApproval(call('over', THREAD)))
      .toEqual({ type: 'user-approval', reason: 'default' })
    expect(approval.getPendingDecision('over')?.decision.rememberOptions)
      .toEqual(['once'])
  })

  it('shares one write cap across every Google write tool', () => {
    const approval = createApproval([
      entryOf(FOLDER, 'write'),
      entryOf(RENAME, 'write'),
      entryOf(MOVE, 'write'),
    ])
    const half = GOOGLE_ALWAYS_ALLOW_WRITES_PER_MESSAGE / 2

    for (let index = 0; index < half; index++) {
      expect(approval.toolApproval(call(`f${index}`, FOLDER)))
        .toBe('not-applicable')
      expect(approval.toolApproval(call(`r${index}`, RENAME)))
        .toBe('not-applicable')
    }

    expect(approval.toolApproval(call('over', MOVE)))
      .toEqual({ type: 'user-approval', reason: 'always-ask' })
    expect(approval.getPendingDecision('over')?.decision.rememberOptions)
      .toEqual(['once'])
  })

  it('keeps counting the always runs a paused reply already holds', () => {
    const prior = countGrantRuns([
      ...Array.from({ length: GOOGLE_ALWAYS_ALLOW_WRITES_PER_MESSAGE }, (
        _value,
        index,
      ) => ({
        type: 'data-tool-grant',
        id: `g${index}`,
        data: { toolCallId: `a${index}`, toolName: FOLDER, scope: 'always' },
      })),
      {
        type: 'data-tool-grant',
        id: 'chat',
        data: { toolCallId: 'x', toolName: SEARCH, scope: 'chat' },
      },
      { type: 'text', text: 'hello' },
    ], 'always')
    const approval = createApproval(
      [entryOf(FOLDER, 'write'), entryOf(SEARCH, 'read')],
      { priorAlwaysGrantRuns: prior },
    )

    expect(prior.get(FOLDER)).toBe(GOOGLE_ALWAYS_ALLOW_WRITES_PER_MESSAGE)
    expect(prior.get(SEARCH)).toBeUndefined()
    expect(approval.toolApproval(call('c1', FOLDER)))
      .toEqual({ type: 'user-approval', reason: 'always-ask' })
    expect(approval.toolApproval(call('c2', SEARCH))).toBe('not-applicable')
  })

  it('asks for a tool whose entry carries Always allow but is not allowable',
    () => {
      const approval = createApproval([
        entryOf('google__drive_save_file', 'write'),
        entryOf('google__drive_read_file', 'read'),
      ])

      expect(approval.toolApproval(call('c1', 'google__drive_save_file')))
        .toEqual({ type: 'user-approval', reason: 'always-ask' })
      expect(approval.toolApproval(call('c2', 'google__drive_read_file')))
        .toEqual({ type: 'user-approval', reason: 'default' })
    })

  it('does not count a chat-grant run toward the always cap', () => {
    const approval = createApproval([entryOf(SEARCH, 'read', 'ask', true)])

    expect(approval.toolApproval(call('c1', SEARCH))).toBe('not-applicable')
    expect(approval.getGrantScope('c1')).toBe('chat')

    const allowing = createApproval([entryOf(SEARCH, 'read')])

    for (let index = 0; index < READ_CAP; index++) {
      expect(allowing.toolApproval(call(`a${index}`, SEARCH)))
        .toBe('not-applicable')
    }
  })
})

describe('the execution id of a write that runs without asking', () => {
  function toolsWith(
    approval: ReturnType<typeof createApproval>,
    toolName: string,
    execute: ReturnType<typeof vi.fn>,
    runGate?: GoogleRunGate,
  ) {
    const guarded = approval.guardNativeWrites(
      { [toolName]: { execute } } as never,
      runGate,
    ) as unknown as Record<string, {
      execute: (input: unknown, options?: unknown) => Promise<unknown>
    }>

    return guarded[toolName]!
  }

  function gateOf() {
    const settle = vi.fn(async () => undefined)
    const begin = vi.fn(async (toolCallId: string) => ({
      executionId: `exec_for_${toolCallId}`,
      settle,
    }))

    return { gate: { begin } as GoogleRunGate, begin, settle }
  }

  it('passes the server-derived id to the write and settles its claim',
    async () => {
      const approval = createApproval([entryOf(FOLDER, 'write')])
      const execute = vi.fn(async () => 'created')
      const { gate, begin, settle } = gateOf()
      const tool = toolsWith(approval, FOLDER, execute, gate)

      approval.toolApproval(call('c1', FOLDER, { name: 'Reports' }))

      expect(await tool.execute(
        { name: 'Reports' },
        { toolCallId: 'c1' },
      )).toBe('created')
      expect(begin).toHaveBeenCalledWith('c1')
      expect(execute).toHaveBeenCalledWith(
        { name: 'Reports' },
        { toolCallId: 'c1', executionId: 'exec_for_c1' },
      )
      expect(settle).toHaveBeenCalledWith(false)
    })

  it('settles the claim as failed when the write throws', async () => {
    const approval = createApproval([entryOf(EVENT, 'write')])
    const execute = vi.fn(async () => {
      throw new Error('Google refused')
    })
    const { gate, settle } = gateOf()
    const tool = toolsWith(approval, EVENT, execute, gate)

    approval.toolApproval(call('c1', EVENT, { title: 'x' }))

    await expect(tool.execute({ title: 'x' }, { toolCallId: 'c1' }))
      .rejects.toThrow('Google refused')
    expect(settle).toHaveBeenCalledWith(true)
  })

  it('never takes the id from the model\'s input or options', async () => {
    const approval = createApproval([entryOf(DRAFT, 'write')])
    const execute = vi.fn(async () => 'ok')
    const { gate } = gateOf()
    const tool = toolsWith(approval, DRAFT, execute, gate)
    const input = { executionId: 'exec_from_model', subject: 's' }

    approval.toolApproval(call('c1', DRAFT, input))
    await tool.execute(input, {
      toolCallId: 'c1',
      executionId: 'exec_from_options',
    })

    expect(execute).toHaveBeenCalledWith(
      input,
      { toolCallId: 'c1', executionId: 'exec_for_c1' },
    )
  })

  it('passes no id to a read, and takes no claim for it', async () => {
    const approval = createApproval([entryOf(SEARCH, 'read')])
    const execute = vi.fn(async () => 'found')
    const { gate, begin } = gateOf()
    const tool = toolsWith(approval, SEARCH, execute, gate)

    approval.toolApproval(call('c1', SEARCH))
    await tool.execute({}, { toolCallId: 'c1' })

    expect(begin).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({}, { toolCallId: 'c1' })
  })

  it('passes no id to a write that asked and was approved', async () => {
    const approval = createApproval([entryOf(DRAFT, 'write', 'ask')])
    const execute = vi.fn(async () => 'ok')
    const { gate, begin } = gateOf()
    const tool = toolsWith(approval, DRAFT, execute, gate)

    approval.markApprovedByUser({
      toolCallId: 'c1',
      toolName: DRAFT,
      input: { subject: 's' },
    })
    approval.toolApproval(call('c1', DRAFT, { subject: 's' }))

    await tool.execute(
      { subject: 's' },
      { toolCallId: 'c1', approvalId: 'approval_one' },
    )

    expect(begin).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith(
      { subject: 's' },
      { toolCallId: 'c1', approvalId: 'approval_one' },
    )
  })

  it('refuses an always-allowed write when there is no gate, and drops its '
    + 'marker', async () => {
    const approval = createApproval([entryOf(FOLDER, 'write')])
    const execute = vi.fn(async () => 'created')
    const tool = toolsWith(approval, FOLDER, execute)

    approval.toolApproval(call('c1', FOLDER, { name: 'x' }))

    expect(approval.getGrantScope('c1')).toBe('always')
    await expect(tool.execute({ name: 'x' }, { toolCallId: 'c1' }))
      .rejects.toMatchObject({ message: GOOGLE_RUN_NO_GATE_TEXT })
    expect(execute).not.toHaveBeenCalled()
    expect(approval.getGrantScope('c1')).toBeNull()
  })

  it('refuses the write and drops the marker when the gate refuses',
    async () => {
      const approval = createApproval([entryOf(FOLDER, 'write')])
      const execute = vi.fn(async () => 'created')
      const gate: GoogleRunGate = {
        begin: vi.fn(async () => {
          throw new Error('Always allow has reached its limit')
        }),
      }
      const tool = toolsWith(approval, FOLDER, execute, gate)

      approval.toolApproval(call('c1', FOLDER, { name: 'x' }))

      await expect(tool.execute({ name: 'x' }, { toolCallId: 'c1' }))
        .rejects.toThrow('reached its limit')
      expect(execute).not.toHaveBeenCalled()
      expect(approval.getGrantScope('c1')).toBeNull()
    })

  it('still refuses a call the policy did not clear', async () => {
    const approval = createApproval([entryOf(FOLDER, 'write')])
    const execute = vi.fn(async () => 'created')
    const { gate, begin } = gateOf()
    const tool = toolsWith(approval, FOLDER, execute, gate)

    await expect(tool.execute({ name: 'x' }, { toolCallId: 'never-decided' }))
      .rejects.toMatchObject({ status: 403 })
    expect(begin).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
})
