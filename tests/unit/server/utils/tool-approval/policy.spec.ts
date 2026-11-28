import { describe, expect, it } from 'vitest'
import {
  clampRemember,
  connectorDestructiveHint,
  isRememberAllowed,
  resolveReplayApproval,
  resolveToolApproval,
} from '~~/server/utils/tool-approval/policy'
import type {
  ReplayPendingTool,
  ResolveToolApprovalInput,
  ToolApprovalDescriptor,
  ToolApprovalGrant,
} from '~~/server/utils/tool-approval/policy'
import {
  connectorReadSource,
  createApprovalState,
  incrementCounter,
  recordRead,
  recordTaint,
  serializeApprovalState,
} from '~~/server/utils/tool-approval/state'
import {
  TOOL_ACCESS_LEVELS,
  TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN,
  TOOL_APPROVAL_MEMORY_WRITE_TOOL_NAMES,
  TOOL_APPROVAL_TAINT_KINDS,
  TOOL_FAMILIES,
  TOOL_PERMISSION_MODES,
} from '#shared/utils/tool-approval-policy'
import type {
  ToolApprovalTaintKind,
} from '#shared/utils/tool-approval-policy'
import {
  MEMORY_FORGET_TOOL_NAME,
  MEMORY_WRITE_TOOL_NAME,
} from '~~/server/utils/memory/tools/memory-constants'

const HASH = 'a'.repeat(64)
const OTHER_HASH = 'b'.repeat(64)
const CONNECTOR_ID = 'conn1'
const OTHER_CONNECTOR_ID = 'conn2'
const TOOL_NAME = 'create_page'
const NON_GOOGLE_TAINT_KINDS = TOOL_APPROVAL_TAINT_KINDS.filter((kind) => {
  return kind !== 'google'
})

function grant(
  overrides: Partial<ToolApprovalGrant> = {},
): ToolApprovalGrant {
  return {
    definitionHash: HASH,
    connectorId: CONNECTOR_ID,
    toolName: TOOL_NAME,
    ...overrides,
  }
}

function stateWith(
  taint: ToolApprovalTaintKind[] = [],
  readSources: string[] = [],
) {
  const state = createApprovalState()

  for (const kind of taint) {
    recordTaint(state, kind)
  }

  for (const source of readSources) {
    recordRead(state, source)
  }

  return state
}

function connectorTool(
  overrides: Partial<ToolApprovalDescriptor> = {},
): ToolApprovalDescriptor {
  return {
    family: 'connector',
    access: 'write',
    toolName: TOOL_NAME,
    connectorId: CONNECTOR_ID,
    definitionHash: HASH,
    destructiveHint: false,
    ...overrides,
  }
}

function besidkaTool(
  overrides: Partial<ToolApprovalDescriptor> = {},
): ToolApprovalDescriptor {
  return {
    family: 'besidka',
    access: 'write',
    toolName: TOOL_NAME,
    definitionHash: HASH,
    destructiveHint: false,
    ...overrides,
  }
}

function nativeTool(
  overrides: Partial<ToolApprovalDescriptor> = {},
): ToolApprovalDescriptor {
  return {
    family: 'native',
    access: 'write',
    toolName: TOOL_NAME,
    destructiveHint: false,
    ...overrides,
  }
}

function decide(
  descriptor: ToolApprovalDescriptor,
  overrides: Partial<Omit<ResolveToolApprovalInput, 'descriptor'>> = {},
) {
  return resolveToolApproval({
    descriptor,
    state: createApprovalState(),
    permissionMode: 'ask',
    ...overrides,
  })
}

describe('resolveToolApproval rules', () => {
  describe('rule 0, blocked by the user', () => {
    it.each([
      ['a connector read', connectorTool({ access: 'read' })],
      ['a Besidka write', besidkaTool()],
      ['a native read', nativeTool({ access: 'read' })],
    ])('denies %s', (_name, descriptor) => {
      const decision = decide(descriptor, { permissionMode: 'blocked' })

      expect(decision.rule).toBe(0)
      expect(decision.status).toEqual({ type: 'denied', reason: 'blocked' })
      expect(decision.rememberOptions).toEqual([])
    })

    it('beats an always grant and a chat grant', () => {
      const decision = decide(connectorTool(), {
        permissionMode: 'blocked',
        alwaysGrant: grant({ definitionHash: HASH }),
        chatGrant: grant({ definitionHash: HASH }),
      })

      expect(decision.rule).toBe(0)
      expect(decision.status.type).toBe('denied')
    })
  })

  describe('rule 1, native read', () => {
    it('needs no approval', () => {
      const decision = decide(nativeTool({ access: 'read' }))

      expect(decision.rule).toBe(1)
      expect(decision.status).toEqual({ type: 'not-applicable' })
      expect(decision.reason).toBeNull()
    })

    it('ignores taint and earlier reads', () => {
      const decision = decide(nativeTool({ access: 'read' }), {
        state: stateWith(
          ['web', 'connector', 'skill'],
          [connectorReadSource(CONNECTOR_ID)],
        ),
      })

      expect(decision.rule).toBe(1)
    })
  })

  describe('rule 2, a write after untrusted content', () => {
    it.each<ToolApprovalTaintKind>([
      'web',
      'skill',
      'knowledge',
      'file',
      'besidka',
      'shared-branch',
    ])('asks for a connector write after %s taint', (kind) => {
      const decision = decide(connectorTool(), { state: stateWith([kind]) })

      expect(decision.rule).toBe(2)
      expect(decision.reason).toBe('untrusted-output')
      expect(decision.status).toEqual({
        type: 'user-approval',
        reason: 'untrusted-output',
      })
    })

    it.each<ToolApprovalTaintKind>([
      'web',
      'connector',
      'skill',
      'knowledge',
      'file',
      'shared-branch',
    ])('asks for a Besidka write after %s taint', (kind) => {
      const decision = decide(besidkaTool(), { state: stateWith([kind]) })

      expect(decision.rule).toBe(2)
    })

    it('does not count taint from the same connector for a write', () => {
      const state = stateWith(['connector'], [connectorReadSource(CONNECTOR_ID)])

      expect(decide(connectorTool(), { state }).rule).toBe(9)
      expect(decide(connectorTool(), {
        state,
        alwaysGrant: grant(),
      }).rule).toBe(6)
      expect(decide(connectorTool(), {
        state,
        chatGrant: grant(),
      }).rule).toBe(7)
    })

    it('counts connector taint as foreign once another source was read', () => {
      for (const otherSource of [
        connectorReadSource(OTHER_CONNECTOR_ID),
        'besidka',
        'overflow',
      ]) {
        const decision = decide(connectorTool(), {
          state: stateWith(['connector'], [
            connectorReadSource(CONNECTOR_ID),
            otherSource,
          ]),
        })

        expect(decision.rule, otherSource).toBe(2)
        expect(decision.rememberOptions, otherSource)
          .toEqual(['once', 'chat', 'always'])
      }
    })

    it('counts connector taint as foreign when the connector id is unknown', () => {
      const decision = decide(connectorTool({ connectorId: undefined }), {
        state: stateWith(['connector'], [connectorReadSource(CONNECTOR_ID)]),
      })

      expect(decision.rule).toBe(2)
    })

    it('does not count Besidka taint for a Besidka write set to Allow', () => {
      const decision = decide(besidkaTool(), {
        state: stateWith(['besidka'], ['besidka']),
        permissionMode: 'allow',
      })

      expect(decision.rule).toBe(6)
    })

    it('counts Besidka taint as foreign after a connector read', () => {
      const decision = decide(besidkaTool(), {
        state: stateWith(['besidka'], [connectorReadSource(CONNECTOR_ID)]),
      })

      expect(decision.rule).toBe(2)
    })

    it.each<ToolApprovalTaintKind>(['connector', 'skill'])(
      'asks for a native write after %s taint',
      (kind) => {
        const decision = decide(nativeTool(), { state: stateWith([kind]) })

        expect(decision.rule).toBe(2)
        expect(decision.reason).toBe('untrusted-output')
      },
    )

    it.each<ToolApprovalTaintKind>([
      'web',
      'knowledge',
      'file',
      'besidka',
      'shared-branch',
    ])('lets a relaxed native write through after %s taint', (kind) => {
      const decision = decide(nativeTool({ onlyConnectorOrSkillTaint: true }), {
        state: stateWith([kind]),
      })

      expect(decision.rule).toBe(8)
      expect(decision.status).toEqual({ type: 'not-applicable' })
    })

    it.each<ToolApprovalTaintKind>([
      'web',
      'knowledge',
      'file',
      'besidka',
      'shared-branch',
    ])('asks for an unmarked native write after %s taint', (kind) => {
      const decision = decide(nativeTool(), { state: stateWith([kind]) })

      expect(decision.rule).toBe(2)
      expect(decision.reason).toBe('untrusted-output')
    })

    it.each(NON_GOOGLE_TAINT_KINDS)(
      'asks for a native memory write after %s taint',
      (kind) => {
        for (const toolName of [
          MEMORY_WRITE_TOOL_NAME,
          MEMORY_FORGET_TOOL_NAME,
        ]) {
          const decision = decide(nativeTool({ toolName }), {
            state: stateWith([kind]),
          })

          expect(decision.rule, toolName).toBe(2)
          expect(decision.reason, toolName).toBe('untrusted-output')
        }
      },
    )

    it('asks for a marked native memory write after web taint', () => {
      const decision = decide(
        nativeTool({ toolName: 'save_note', writesMemory: true }),
        { state: stateWith(['web']) },
      )

      expect(decision.rule).toBe(2)
    })

    it('lets a native memory write through when nothing is tainted', () => {
      const decision = decide(nativeTool({ toolName: MEMORY_WRITE_TOOL_NAME }))

      expect(decision.rule).toBe(8)
    })

    it('keeps the native memory tool names in step with the memory tools', () => {
      expect([...TOOL_APPROVAL_MEMORY_WRITE_TOOL_NAMES].sort())
        .toEqual([MEMORY_FORGET_TOOL_NAME, MEMORY_WRITE_TOOL_NAME].sort())
    })

    it('keeps artifact and document writes on connector and skill taint', () => {
      for (const toolName of ['create_artifact', 'create_document']) {
        const descriptor = nativeTool({
          toolName,
          onlyConnectorOrSkillTaint: true,
        })

        expect(decide(descriptor, {
          state: stateWith(['web', 'knowledge', 'file']),
        }).rule, toolName).toBe(8)
        expect(decide(descriptor, {
          state: stateWith(['connector']),
        }).rule, toolName).toBe(2)
      }
    })

    it('asks for a delete after taint as untrusted-output, not always-ask', () => {
      const decision = decide(besidkaTool({ access: 'delete' }), {
        state: stateWith(['web']),
      })

      expect(decision.rule).toBe(2)
      expect(decision.reason).toBe('untrusted-output')
    })

    it('is lifted by Allow, an always grant or a chat grant (owner '
      + 'decision, 2026-11-20)', () => {
      const state = stateWith(['web', 'connector'], [
        connectorReadSource(OTHER_CONNECTOR_ID),
      ])

      expect(decide(besidkaTool(), { state, permissionMode: 'allow' }).rule)
        .toBe(6)
      expect(decide(connectorTool(), { state, alwaysGrant: grant() }).rule)
        .toBe(6)
      expect(decide(connectorTool(), { state, chatGrant: grant() }).rule)
        .toBe(7)
    })

    it('offers every answer for a connector or Besidka write', () => {
      for (const descriptor of [connectorTool(), besidkaTool()]) {
        const decision = decide(descriptor, { state: stateWith(['web']) })

        expect(decision.rule, descriptor.family).toBe(2)
        expect(decision.rememberOptions, descriptor.family)
          .toEqual(['once', 'chat', 'always'])
      }
    })

    it('offers only Allow once for a native write', () => {
      const decision = decide(nativeTool(), { state: stateWith(['web']) })

      expect(decision.rule).toBe(2)
      expect(decision.rememberOptions).toEqual(['once'])
    })

    it('asks again under a grant after the definition changed', () => {
      const decision = decide(connectorTool(), {
        state: stateWith(['web']),
        alwaysGrant: grant({ definitionHash: OTHER_HASH }),
        chatGrant: grant({ definitionHash: OTHER_HASH }),
      })

      expect(decision.rule).toBe(2)
    })

    it('comes before the cross-source rule', () => {
      const decision = decide(connectorTool(), {
        state: stateWith(['web'], [connectorReadSource(OTHER_CONNECTOR_ID)]),
      })

      expect(decision.rule).toBe(2)
      expect(decision.reason).toBe('untrusted-output')
    })

    it('asks for a connector read with every answer offered', () => {
      const decision = decide(connectorTool({ access: 'read' }), {
        state: stateWith(['web']),
      })

      expect(decision.rule).toBe(2)
      expect(decision.rememberOptions).toEqual(['once', 'chat', 'always'])
    })
  })

  describe('rule 3, a connector write after reading another source', () => {
    it('asks when another connector was read', () => {
      const decision = decide(connectorTool(), {
        state: stateWith([], [connectorReadSource(OTHER_CONNECTOR_ID)]),
      })

      expect(decision.rule).toBe(3)
      expect(decision.reason).toBe('cross-source')
    })

    it('asks when Besidka data was read', () => {
      const decision = decide(connectorTool(), {
        state: stateWith([], ['besidka']),
      })

      expect(decision.rule).toBe(3)
    })

    it('asks when both this and another connector were read', () => {
      const decision = decide(connectorTool(), {
        state: stateWith([], [
          connectorReadSource(CONNECTOR_ID),
          connectorReadSource(OTHER_CONNECTOR_ID),
        ]),
      })

      expect(decision.rule).toBe(3)
    })

    it('does not ask when only this connector was read', () => {
      const decision = decide(connectorTool(), {
        state: stateWith([], [connectorReadSource(CONNECTOR_ID)]),
      })

      expect(decision.rule).toBe(9)
    })

    it('asks when the connector id is unknown and anything was read', () => {
      const decision = decide(
        connectorTool({ connectorId: undefined }),
        { state: stateWith([], [connectorReadSource(CONNECTOR_ID)]) },
      )

      expect(decision.rule).toBe(3)
    })

    it('is lifted by an always grant or a chat grant', () => {
      const state = stateWith([], ['besidka'])

      expect(decide(connectorTool(), { state, alwaysGrant: grant() }).rule)
        .toBe(6)
      expect(decide(connectorTool(), { state, chatGrant: grant() }).rule)
        .toBe(7)
      expect(decide(connectorTool(), { state }).rememberOptions)
        .toEqual(['once', 'chat', 'always'])
    })

    it('does not apply to Besidka tools', () => {
      const decision = decide(besidkaTool(), {
        state: stateWith([], [connectorReadSource(CONNECTOR_ID)]),
      })

      expect(decision.rule).toBe(9)
    })
  })

  describe('reads (owner decision, 2026-11-15)', () => {
    const everyTaint = [...TOOL_APPROVAL_TAINT_KINDS]
    const otherSources = [
      connectorReadSource(OTHER_CONNECTOR_ID),
      'besidka',
      'overflow',
    ]
    const ownSource = [connectorReadSource(CONNECTOR_ID)]

    it('runs a Besidka read set to Always allow after every taint kind', () => {
      const decision = decide(besidkaTool({ access: 'read' }), {
        state: stateWith(everyTaint, otherSources),
        permissionMode: 'allow',
      })

      expect(decision.rule).toBe(6)
      expect(decision.status).toEqual({ type: 'not-applicable' })
    })

    it('runs a connector read with an always or chat grant after its own '
      + 'connector\'s result', () => {
      const state = stateWith(['connector'], ownSource)

      expect(decide(connectorTool({ access: 'read' }), {
        state,
        alwaysGrant: grant(),
      }).rule).toBe(6)
      expect(decide(connectorTool({ access: 'read' }), {
        state,
        chatGrant: grant(),
      }).rule).toBe(7)
    })

    it.each<ToolApprovalTaintKind>([
      'web',
      'skill',
      'knowledge',
      'file',
      'besidka',
      'shared-branch',
    ])('runs an Always allow connector read after %s taint, and asks one '
      + 'set to Needs approval with every answer', (kind) => {
      const state = stateWith([kind])
      const allowedRead = decide(connectorTool({ access: 'read' }), {
        state,
        alwaysGrant: grant(),
      })
      const askedRead = decide(connectorTool({ access: 'read' }), { state })

      expect(allowedRead.rule).toBe(6)
      expect(askedRead.rule).toBe(2)
      expect(askedRead.reason).toBe('untrusted-output')
      expect(askedRead.rememberOptions).toEqual(['once', 'chat', 'always'])
    })

    it('runs an Always allow connector read after another source (F2)', () => {
      for (const otherSource of otherSources) {
        const state = stateWith([], [...ownSource, otherSource])
        const allowedRead = decide(connectorTool({ access: 'read' }), {
          state,
          alwaysGrant: grant(),
        })
        const askedRead = decide(connectorTool({ access: 'read' }), { state })

        expect(allowedRead.rule, otherSource).toBe(6)
        expect(askedRead.rule, otherSource).toBe(3)
        expect(askedRead.reason, otherSource).toBe('cross-source')
        expect(askedRead.rememberOptions, otherSource)
          .toEqual(['once', 'chat', 'always'])
      }
    })

    it('runs a read on its default grant after another source', () => {
      const decision = decide(connectorTool({ access: 'read' }), {
        state: stateWith(['web'], [connectorReadSource(OTHER_CONNECTOR_ID)]),
        alwaysGrant: grant(),
        isAlwaysGrantDefault: true,
      })

      expect(decision.rule).toBe(6)
    })

    it.each<ToolApprovalTaintKind>(TOOL_APPROVAL_TAINT_KINDS)(
      'asks a Besidka read set to Needs approval after %s taint with every '
      + 'answer',
      (kind) => {
        const decision = decide(besidkaTool({ access: 'read' }), {
          state: stateWith([kind], otherSources),
        })

        expect(decision.rule).toBe(9)
        expect(decision.reason).toBe('default')
        expect(decision.rememberOptions).toEqual(['once', 'chat', 'always'])
      },
    )

    it('asks a connector read set to Needs approval with every answer', () => {
      const decision = decide(connectorTool({ access: 'read' }), {
        state: stateWith(['connector'], ownSource),
      })

      expect(decision.rule).toBe(9)
      expect(decision.rememberOptions).toEqual(['once', 'chat', 'always'])
    })

    it('asks a read again after its definition changed', () => {
      const decision = decide(connectorTool({ access: 'read' }), {
        alwaysGrant: grant({ definitionHash: OTHER_HASH }),
      })

      expect(decision.rule).toBe(9)
    })

    it('honors the user\'s Always allow on a read in the always-ask tier',
      () => {
        const descriptor = connectorTool({
          access: 'read',
          destructiveHint: true,
        })

        expect(decide(descriptor, { alwaysGrant: grant() }).rule).toBe(6)
        expect(decide(descriptor).rule).toBe(5)
        expect(decide(descriptor).rememberOptions)
          .toEqual(['once', 'chat', 'always'])
      })

    it('never lifts the always-ask tier with a default grant', () => {
      const decision = decide(
        connectorTool({ access: 'read', destructiveHint: true }),
        { alwaysGrant: grant(), isAlwaysGrantDefault: true },
      )

      expect(decision.rule).toBe(5)
    })
  })

  describe('rule 5, always ask', () => {
    it.each([
      ['a Besidka delete', besidkaTool({ access: 'delete' })],
      ['a Besidka instructions write', besidkaTool({ access: 'instructions' })],
      ['a native delete', nativeTool({ access: 'delete' })],
      ['a native instructions write', nativeTool({ access: 'instructions' })],
      ['a connector delete', connectorTool({ access: 'delete' })],
      [
        'a destructive connector write',
        connectorTool({ destructiveHint: true }),
      ],
      [
        'a destructive connector read',
        connectorTool({ access: 'read', destructiveHint: true }),
      ],
    ])('asks for %s', (_name, descriptor) => {
      const decision = decide(descriptor)

      expect(decision.rule).toBe(5)
      expect(decision.reason).toBe('always-ask')
      expect(decision.status).toEqual({
        type: 'user-approval',
        reason: 'always-ask',
      })
    })

    it('is lifted by Allow, an always grant or a chat grant (owner '
      + 'decision, 2026-11-20)', () => {
      const deleteTool = besidkaTool({ access: 'delete' })
      const destructive = connectorTool({ destructiveHint: true })

      expect(decide(deleteTool, { permissionMode: 'allow' }).rule).toBe(6)
      expect(decide(deleteTool, { chatGrant: grant() }).rule).toBe(7)
      expect(decide(destructive, { alwaysGrant: grant() }).rule).toBe(6)
      expect(decide(destructive, { chatGrant: grant() }).rule).toBe(7)
    })

    it('offers every answer for a connector or Besidka tool', () => {
      expect(decide(besidkaTool({ access: 'delete' })).rememberOptions)
        .toEqual(['once', 'chat', 'always'])
      expect(decide(connectorTool({ destructiveHint: true })).rememberOptions)
        .toEqual(['once', 'chat', 'always'])
    })

    it('offers only Allow once for a native tool', () => {
      expect(decide(nativeTool({ access: 'delete' })).rememberOptions)
        .toEqual(['once'])
    })

    it('asks again under a grant given for another definition', () => {
      const decision = decide(connectorTool({ destructiveHint: true }), {
        alwaysGrant: grant({ definitionHash: OTHER_HASH }),
        chatGrant: grant({ definitionHash: OTHER_HASH }),
      })

      expect(decision.rule).toBe(5)
    })

    it('treats destructiveHint true as always-ask for every family', () => {
      for (const descriptor of [
        connectorTool({ destructiveHint: true }),
        besidkaTool({ destructiveHint: true }),
        nativeTool({ destructiveHint: true }),
      ]) {
        expect(decide(descriptor).rule, descriptor.family).toBe(5)
      }
    })

    it('does not treat destructiveHint false as a signal', () => {
      const decision = decide(connectorTool({ destructiveHint: false }))

      expect(decision.rule).toBe(9)
    })
  })

  describe('rule 6, an always grant', () => {
    it('runs a connector tool when the definition hash matches', () => {
      const decision = decide(connectorTool(), {
        alwaysGrant: grant({ definitionHash: HASH }),
      })

      expect(decision.rule).toBe(6)
      expect(decision.status).toEqual({ type: 'not-applicable' })
    })

    it('asks again after the definition hash changed', () => {
      const decision = decide(connectorTool(), {
        alwaysGrant: grant({ definitionHash: OTHER_HASH }),
      })

      expect(decision.rule).toBe(9)
    })

    it('never matches a grant without a hash', () => {
      const decision = decide(connectorTool(), {
        alwaysGrant: grant({ definitionHash: null }),
      })

      expect(decision.rule).toBe(9)
    })

    it('never matches a tool without a hash', () => {
      const decision = decide(connectorTool({ definitionHash: undefined }), {
        alwaysGrant: grant({ definitionHash: HASH }),
      })

      expect(decision.rule).toBe(9)
    })

    it('never matches when both hashes are missing', () => {
      const decision = decide(connectorTool({ definitionHash: undefined }), {
        alwaysGrant: grant({ definitionHash: null }),
      })

      expect(decision.rule).toBe(9)
    })

    it('never matches when both hashes are empty strings', () => {
      const decision = decide(connectorTool({ definitionHash: '' }), {
        alwaysGrant: grant({ definitionHash: '' }),
      })

      expect(decision.rule).toBe(9)
    })

    it('runs a Besidka tool set to Allow without a hash', () => {
      const decision = decide(besidkaTool({ definitionHash: undefined }), {
        permissionMode: 'allow',
      })

      expect(decision.rule).toBe(6)
    })

    it('ignores Allow on a connector tool', () => {
      const decision = decide(connectorTool(), { permissionMode: 'allow' })

      expect(decision.rule).toBe(9)
    })

    it('ignores Allow on a native tool that is not a plain write', () => {
      const decision = decide(nativeTool({ access: 'delete' }), {
        permissionMode: 'allow',
      })

      expect(decision.rule).toBe(5)
    })
  })

  describe('grant identity', () => {
    it.each([
      ['rule 6', 'alwaysGrant', 6],
      ['rule 7', 'chatGrant', 7],
    ] as const)('%s needs the connector id, tool name and hash', (
      _name,
      grantKey,
      rule,
    ) => {
      expect(decide(connectorTool(), {
        [grantKey]: grant(),
      }).rule).toBe(rule)
      expect(decide(connectorTool(), {
        [grantKey]: grant({ connectorId: OTHER_CONNECTOR_ID }),
      }).rule).toBe(9)
      expect(decide(connectorTool(), {
        [grantKey]: grant({ connectorId: null }),
      }).rule).toBe(9)
      expect(decide(connectorTool(), {
        [grantKey]: grant({ toolName: 'delete_page' }),
      }).rule).toBe(9)
      expect(decide(connectorTool(), {
        [grantKey]: grant({ toolName: '' }),
      }).rule).toBe(9)
    })

    it('does not carry a grant to another connector with the same hash', () => {
      const decision = decide(
        connectorTool({ connectorId: OTHER_CONNECTOR_ID }),
        { alwaysGrant: grant() },
      )

      expect(decision.rule).toBe(9)
    })

    it('matches a Besidka grant on tool name and hash', () => {
      expect(decide(besidkaTool(), {
        chatGrant: grant({ connectorId: null }),
      }).rule).toBe(7)
      expect(decide(besidkaTool(), {
        chatGrant: grant({ connectorId: null, toolName: 'update_chat' }),
      }).rule).toBe(9)
      expect(decide(besidkaTool(), {
        chatGrant: grant({ connectorId: null, definitionHash: OTHER_HASH }),
      }).rule).toBe(9)
    })
  })

  describe('rule 7, a chat grant', () => {
    it('runs a tool when the definition hash matches', () => {
      const decision = decide(connectorTool(), {
        chatGrant: grant({ definitionHash: HASH }),
      })

      expect(decision.rule).toBe(7)
      expect(decision.status).toEqual({ type: 'not-applicable' })
    })

    it('asks again after the definition hash changed', () => {
      const decision = decide(connectorTool(), {
        chatGrant: grant({ definitionHash: OTHER_HASH }),
      })

      expect(decision.rule).toBe(9)
    })

    it('never matches a grant without a hash', () => {
      const decision = decide(besidkaTool(), {
        chatGrant: grant({ definitionHash: null }),
      })

      expect(decision.rule).toBe(9)
    })

    it('runs a Besidka tool when the registry hash matches', () => {
      const decision = decide(besidkaTool(), {
        chatGrant: grant({ definitionHash: HASH }),
      })

      expect(decision.rule).toBe(7)
    })

    it('comes after the always grant', () => {
      const decision = decide(connectorTool(), {
        alwaysGrant: grant({ definitionHash: HASH }),
        chatGrant: grant({ definitionHash: HASH }),
      })

      expect(decision.rule).toBe(6)
    })
  })

  describe('rule 8, a native write', () => {
    it('needs no approval when nothing untrusted was seen', () => {
      const decision = decide(nativeTool())

      expect(decision.rule).toBe(8)
      expect(decision.status).toEqual({ type: 'not-applicable' })
    })
  })

  describe('rule 12, Always allow for memory writes', () => {
    const memoryWriteTool = () => {
      return nativeTool({ toolName: MEMORY_WRITE_TOOL_NAME })
    }
    const memoryForgetTool = () => {
      return nativeTool({ toolName: MEMORY_FORGET_TOOL_NAME })
    }

    it.each(NON_GOOGLE_TAINT_KINDS)(
      'runs memory_write set to Always allow after %s taint',
      (kind) => {
        const decision = decide(memoryWriteTool(), {
          state: stateWith([kind]),
          permissionMode: 'allow',
        })

        expect(decision.rule).toBe(12)
        expect(decision.status).toEqual({ type: 'not-applicable' })
        expect(decision.rememberOptions).toEqual([])
      },
    )

    it('runs after every taint kind at once', () => {
      const decision = decide(memoryWriteTool(), {
        state: stateWith(['web', 'file', 'knowledge', 'shared-branch']),
        permissionMode: 'allow',
      })

      expect(decision.rule).toBe(12)
    })

    it.each(NON_GOOGLE_TAINT_KINDS)(
      'keeps asking for memory_forget after %s taint, even if a stored '
      + 'Always allow reached the policy',
      (kind) => {
        for (const permissionMode of ['ask', 'allow'] as const) {
          const decision = decide(memoryForgetTool(), {
            state: stateWith([kind]),
            permissionMode,
          })

          expect(decision.rule, permissionMode).toBe(2)
          expect(decision.reason, permissionMode).toBe('untrusted-output')
          expect(decision.rememberOptions, permissionMode).toEqual(['once'])
        }
      },
    )

    it('keeps the untainted behavior of memory_forget as on main', () => {
      expect(decide(memoryForgetTool()).rule).toBe(8)
    })

    it('denies a memory tool set to Blocked before anything else', () => {
      for (const tool of [memoryWriteTool(), memoryForgetTool()]) {
        const decision = decide(tool, { permissionMode: 'blocked' })

        expect(decision.rule).toBe(0)
        expect(decision.status).toEqual({ type: 'denied', reason: 'blocked' })
      }
    })

    it('keeps asking memory_write after taint by default and offers Always '
      + 'allow', () => {
      const decision = decide(memoryWriteTool(), {
        state: stateWith(['web']),
      })

      expect(decision.rule).toBe(2)
      expect(decision.reason).toBe('untrusted-output')
      expect(decision.rememberOptions).toEqual(['once', 'always'])
    })

    it('lets memory_write through on a clean send under both modes', () => {
      expect(decide(memoryWriteTool()).rule).toBe(8)
      expect(decide(memoryWriteTool(), { permissionMode: 'allow' }).rule)
        .toBe(12)
    })

    it('does not lift the taint rule for any other native write', () => {
      for (const toolName of ['create_artifact', 'create_document', TOOL_NAME]) {
        const decision = decide(nativeTool({
          toolName,
          ...(toolName === TOOL_NAME
            ? {}
            : { onlyConnectorOrSkillTaint: true }),
        }), {
          state: stateWith(['connector']),
          permissionMode: 'allow',
        })

        expect(decision.rule, toolName).toBe(2)
        expect(decision.rememberOptions, toolName).toEqual(['once'])
      }
    })

    it('does not treat a marked non-memory tool as a memory setting', () => {
      const decision = decide(
        nativeTool({ toolName: 'save_note', writesMemory: true }),
        { state: stateWith(['web']), permissionMode: 'allow' },
      )

      expect(decision.rule).toBe(2)
    })

    it('does not change the rule for connector or Besidka tools of the '
      + 'same name', () => {
      expect(decide(
        connectorTool({ toolName: MEMORY_WRITE_TOOL_NAME }),
        { permissionMode: 'allow' },
      ).rule).toBe(9)
      expect(decide(
        besidkaTool({ toolName: MEMORY_WRITE_TOOL_NAME }),
        { permissionMode: 'allow' },
      ).rule).toBe(6)
    })

    it('clamps Always allow for a memory_write prompt but not Allow in this '
      + 'chat, and offers neither for memory_forget', () => {
      const write = decide(memoryWriteTool(), { state: stateWith(['web']) })
      const forget = decide(memoryForgetTool(), { state: stateWith(['web']) })

      expect(isRememberAllowed(write, 'always')).toBe(true)
      expect(clampRemember(write, 'always')).toBe('always')
      expect(clampRemember(write, 'chat')).toBe('once')
      expect(isRememberAllowed(forget, 'always')).toBe(false)
      expect(clampRemember(forget, 'always')).toBe('once')
    })
  })

  describe('rule 15, a memory write after Google content', () => {
    const memoryTools = () => {
      const toolNames = [MEMORY_WRITE_TOOL_NAME, MEMORY_FORGET_TOOL_NAME]

      return toolNames.map((toolName) => {
        return nativeTool({ toolName })
      })
    }

    it.each(TOOL_PERMISSION_MODES.filter(mode => mode !== 'blocked'))(
      'denies both memory write tools after google taint on mode %s',
      (permissionMode) => {
        for (const descriptor of memoryTools()) {
          const decision = decide(descriptor, {
            state: stateWith(['google']),
            permissionMode,
          })

          expect(decision.rule, descriptor.toolName).toBe(15)
          expect(decision.status, descriptor.toolName)
            .toEqual({ type: 'denied', reason: 'google-data' })
          expect(decision.reason, descriptor.toolName).toBeNull()
          expect(decision.rememberOptions, descriptor.toolName).toEqual([])
        }
      },
    )

    it.each(TOOL_APPROVAL_TAINT_KINDS)(
      'denies memory_write set to Always allow when %s taint comes with '
      + 'google taint',
      (kind) => {
        const decision = decide(
          nativeTool({ toolName: MEMORY_WRITE_TOOL_NAME }),
          {
            state: stateWith([kind, 'google']),
            permissionMode: 'allow',
          },
        )

        expect(decision.rule).toBe(15)
        expect(decision.status)
          .toEqual({ type: 'denied', reason: 'google-data' })
        expect(decision.grant).toBeUndefined()
      },
    )

    it('offers no remember option, so no answer can turn into a grant', () => {
      const decision = decide(
        nativeTool({ toolName: MEMORY_WRITE_TOOL_NAME }),
        { state: stateWith(['google']), permissionMode: 'allow' },
      )

      expect(isRememberAllowed(decision, 'always')).toBe(false)
      expect(isRememberAllowed(decision, 'chat')).toBe(false)
      expect(clampRemember(decision, 'always')).toBe('once')
    })

    it('denies a native tool the policy knows as a memory writer', () => {
      const decision = decide(
        nativeTool({ toolName: 'save_note', writesMemory: true }),
        { state: stateWith(['google']) },
      )

      expect(decision.rule).toBe(15)
    })

    it('keeps Blocked ahead of the Google denial', () => {
      const decision = decide(
        nativeTool({ toolName: MEMORY_WRITE_TOOL_NAME }),
        { state: stateWith(['google']), permissionMode: 'blocked' },
      )

      expect(decision.rule).toBe(0)
      expect(decision.status).toEqual({ type: 'denied', reason: 'blocked' })
    })

    it('leaves a native memory read, other native writes and other families '
      + 'to their own rules', () => {
      expect(decide(
        nativeTool({ toolName: 'memory_list', access: 'read' }),
        { state: stateWith(['google']) },
      ).rule).toBe(1)
      expect(decide(
        nativeTool({
          toolName: 'create_artifact',
          onlyConnectorOrSkillTaint: true,
        }),
        { state: stateWith(['google']) },
      ).rule).toBe(2)
      expect(decide(
        besidkaTool({ toolName: MEMORY_WRITE_TOOL_NAME }),
        { state: stateWith(['google']), permissionMode: 'allow' },
      ).rule).toBe(14)
    })

    it('still lets memory_write through Always allow while the send holds '
      + 'no Google taint', () => {
      const decision = decide(
        nativeTool({ toolName: MEMORY_WRITE_TOOL_NAME }),
        { state: stateWith(['web']), permissionMode: 'allow' },
      )

      expect(decision.rule).toBe(12)
      expect(decision.grant).toBeUndefined()
    })
  })

  describe('rule 9, the default', () => {
    it.each([
      ['a connector read', connectorTool({ access: 'read' })],
      ['a connector write', connectorTool()],
      ['a Besidka read', besidkaTool({ access: 'read' })],
      ['a Besidka write', besidkaTool()],
    ])('asks for %s', (_name, descriptor) => {
      const decision = decide(descriptor)

      expect(decision.rule).toBe(9)
      expect(decision.reason).toBe('default')
      expect(decision.status).toEqual({
        type: 'user-approval',
        reason: 'default',
      })
    })
  })
})

describe('consent gate', () => {
  function consentGate(
    overrides: Partial<ToolApprovalDescriptor> = {},
  ): ToolApprovalDescriptor {
    return nativeTool({
      toolName: 'run_skill_scripts',
      definitionHash: HASH,
      consentGate: true,
      ...overrides,
    })
  }

  function chatGrantFor(hash: string | null = HASH): ToolApprovalGrant {
    return {
      definitionHash: hash,
      connectorId: null,
      toolName: 'run_skill_scripts',
    }
  }

  it('asks for consent, offering once and chat only, with no grant', () => {
    const decision = decide(consentGate())

    expect(decision.rule).toBe(10)
    expect(decision.reason).toBe('consent')
    expect(decision.status).toEqual({
      type: 'user-approval',
      reason: 'consent',
    })
    expect(decision.rememberOptions).toEqual(['once', 'chat'])
  })

  it('asks even though a plain native write would pass', () => {
    expect(decide(nativeTool()).status).toEqual({ type: 'not-applicable' })
    expect(decide(consentGate()).status.type).toBe('user-approval')
  })

  it('lets a chat grant for the same hash through', () => {
    const decision = decide(consentGate(), { chatGrant: chatGrantFor() })

    expect(decision.rule).toBe(10)
    expect(decision.status).toEqual({ type: 'not-applicable' })
  })

  it('asks again for a chat grant that was given for another hash', () => {
    const decision = decide(consentGate(), {
      chatGrant: chatGrantFor(OTHER_HASH),
    })

    expect(decision.status.type).toBe('user-approval')
  })

  it('never takes an always grant', () => {
    const decision = decide(consentGate(), { alwaysGrant: chatGrantFor() })

    expect(decision.status.type).toBe('user-approval')
    expect(decision.rememberOptions).not.toContain('always')
  })

  it('asks after untrusted content the same way, and still offers chat', () => {
    const decision = decide(consentGate(), {
      state: stateWith(['web', 'skill', 'connector']),
    })

    expect(decision.reason).toBe('consent')
    expect(decision.rememberOptions).toEqual(['once', 'chat'])
  })

  it('lets a chat grant through after untrusted content', () => {
    const decision = decide(consentGate(), {
      state: stateWith(['skill']),
      chatGrant: chatGrantFor(),
    })

    expect(decision.status).toEqual({ type: 'not-applicable' })
  })

  it('is denied when the user blocked it, and on invalid input', () => {
    expect(decide(consentGate(), { permissionMode: 'blocked' }).status)
      .toEqual({ type: 'denied', reason: 'blocked' })
    expect(decide(consentGate({ toolName: '' })).status)
      .toEqual({ type: 'denied', reason: 'invalid-input' })
  })

  it('downgrades an always answer to once', () => {
    const decision = decide(consentGate())

    expect(clampRemember(decision, 'always')).toBe('once')
    expect(clampRemember(decision, 'chat')).toBe('chat')
  })

  it('replays an approved call while the tool still matches', () => {
    const replay = resolveReplayApproval({
      descriptor: consentGate(),
      pending: {
        family: 'native',
        access: 'write',
        toolName: 'run_skill_scripts',
        definitionHash: HASH,
      },
      state: createApprovalState(),
      permissionMode: 'ask',
    })

    expect(replay.status).toEqual({ type: 'not-applicable' })
  })
})

describe('replay of a native tool that carries a definition hash', () => {
  function gate(
    overrides: Partial<ToolApprovalDescriptor> = {},
  ): ToolApprovalDescriptor {
    return nativeTool({
      toolName: 'run_skill_scripts',
      definitionHash: HASH,
      consentGate: true,
      ...overrides,
    })
  }

  function replay(
    descriptor: ToolApprovalDescriptor,
    definitionHash: string | null | undefined,
  ) {
    return resolveReplayApproval({
      descriptor,
      pending: {
        family: 'native',
        access: 'write',
        toolName: 'run_skill_scripts',
        definitionHash,
      },
      state: createApprovalState(),
      permissionMode: 'ask',
    })
  }

  it('passes while the approved hash is still the current one', () => {
    expect(replay(gate(), HASH).status).toEqual({ type: 'not-applicable' })
  })

  it('denies as drifted when the set of skills changed after the request', () => {
    expect(replay(gate(), OTHER_HASH)).toEqual({
      status: { type: 'denied', reason: 'definition-drifted' },
      denialReason: 'definition-drifted',
    })
  })

  it('denies as drifted for a request stored without a hash', () => {
    expect(replay(gate(), null).denialReason).toBe('definition-drifted')
    expect(replay(gate(), undefined).denialReason).toBe('definition-drifted')
  })

  it('keeps a native tool without a hash as it was', () => {
    expect(replay(nativeTool({ toolName: 'run_skill_scripts' }), null)
      .status).toEqual({ type: 'not-applicable' })
    expect(replay(nativeTool({ toolName: 'run_skill_scripts' }), HASH)
      .status).toEqual({ type: 'not-applicable' })
  })
})

describe('fail closed on invalid input', () => {
  it.each([
    ['an unknown permission mode', { permissionMode: 'maybe' }],
    ['a missing permission mode', { permissionMode: undefined }],
  ])('denies %s', (_name, overrides) => {
    const decision = decide(
      nativeTool({ access: 'read' }),
      overrides as Partial<ResolveToolApprovalInput>,
    )

    expect(decision.status).toEqual({
      type: 'denied',
      reason: 'invalid-input',
    })
    expect(decision.rememberOptions).toEqual([])
  })

  it.each([
    ['an unknown family', { family: 'remote' }],
    ['an unknown access', { access: 'admin' }],
    ['an empty tool name', { toolName: '' }],
    ['a blank tool name', { toolName: '   ' }],
    ['a missing tool name', { toolName: undefined }],
    ['a missing destructiveHint', { destructiveHint: undefined }],
    ['a string destructiveHint', { destructiveHint: 'false' }],
  ])('denies %s before any rule', (_name, overrides) => {
    const decision = decide({
      ...nativeTool({ access: 'read' }),
      ...overrides,
    } as ToolApprovalDescriptor)

    expect(decision.rule).toBe(0)
    expect(decision.status).toEqual({
      type: 'denied',
      reason: 'invalid-input',
    })
  })

  it('denies a missing descriptor', () => {
    const decision = decide(null as unknown as ToolApprovalDescriptor)

    expect(decision.status).toEqual({
      type: 'denied',
      reason: 'invalid-input',
    })
  })

  it('answers every known family, access and mode', () => {
    for (const family of TOOL_FAMILIES) {
      for (const access of TOOL_ACCESS_LEVELS) {
        for (const permissionMode of TOOL_PERMISSION_MODES) {
          const decision = decide(
            {
              family,
              access,
              toolName: TOOL_NAME,
              connectorId: CONNECTOR_ID,
              definitionHash: HASH,
              destructiveHint: false,
            },
            { permissionMode },
          )

          expect(
            decision.status.type === 'denied'
            && decision.status.reason === 'invalid-input',
            `${family} ${access} ${permissionMode}`,
          ).toBe(false)
        }
      }
    }
  })
})

describe('connectorDestructiveHint', () => {
  it.each([
    ['destructiveHint true', { destructiveHint: true }],
    ['destructiveHint true next to readOnlyHint true', {
      readOnlyHint: true,
      destructiveHint: true,
    }],
  ])('is true for %s', (_name, annotations) => {
    expect(connectorDestructiveHint(annotations)).toBe(true)
  })

  it.each([
    ['no annotations', undefined],
    ['null annotations', null],
    ['empty annotations', {}],
    ['readOnlyHint true', { readOnlyHint: true }],
    ['readOnlyHint false', { readOnlyHint: false }],
    ['destructiveHint null', { destructiveHint: null }],
    ['destructiveHint false alone', { destructiveHint: false }],
    ['destructiveHint false next to readOnlyHint false', {
      readOnlyHint: false,
      destructiveHint: false,
    }],
  ])('is false for %s', (_name, annotations) => {
    expect(connectorDestructiveHint(annotations)).toBe(false)
  })

  it('treats destructiveHint false exactly like a missing hint', () => {
    const withFalse = decide(connectorTool({
      destructiveHint: connectorDestructiveHint({ destructiveHint: false }),
    }))
    const withoutHint = decide(connectorTool({
      destructiveHint: connectorDestructiveHint({}),
    }))

    expect(withFalse).toEqual(withoutHint)
    expect(withFalse.reason).toBe('default')
    expect(withFalse.rememberOptions).toEqual(['once', 'chat', 'always'])
  })

  it('never skips the prompt for destructiveHint false', () => {
    const descriptor = connectorTool({
      destructiveHint: connectorDestructiveHint({ destructiveHint: false }),
    })

    expect(decide(descriptor).status.type).toBe('user-approval')
  })

  it('keeps an explicit destructiveHint true in always-ask', () => {
    const descriptor = connectorTool({
      destructiveHint: connectorDestructiveHint({ destructiveHint: true }),
    })
    const decision = decide(descriptor)

    expect(decision.rule).toBe(5)
    expect(decision.rememberOptions).toEqual(['once', 'chat', 'always'])
  })
})

describe('button matrix', () => {
  it.each([
    ['untrusted-output', ['once', 'chat', 'always']],
    ['cross-source', ['once', 'chat', 'always']],
    ['always-ask', ['once', 'chat', 'always']],
    ['default', ['once', 'chat', 'always']],
  ])('offers %j remember options %j', (reason, options) => {
    const decisions = [
      decide(connectorTool(), { state: stateWith(['web']) }),
      decide(connectorTool(), {
        state: stateWith([], ['besidka']),
      }),
      decide(besidkaTool({ access: 'delete' })),
      decide(connectorTool()),
    ]
    const decision = decisions.find(candidate => candidate.reason === reason)

    expect(decision?.rememberOptions).toEqual(options)
  })

  it('offers nothing when no question is asked', () => {
    expect(decide(nativeTool()).rememberOptions).toEqual([])
    expect(
      decide(connectorTool(), { permissionMode: 'blocked' }).rememberOptions,
    ).toEqual([])
  })

  it('allows only the offered remember choices', () => {
    const native = decide(nativeTool(), { state: stateWith(['web']) })
    const forced = decide(connectorTool(), { state: stateWith(['web']) })
    const always = decide(besidkaTool({ access: 'delete' }))
    const consent = decide(nativeTool({ consentGate: true }))

    expect(isRememberAllowed(native, 'once')).toBe(true)
    expect(isRememberAllowed(native, 'chat')).toBe(false)
    expect(isRememberAllowed(native, 'always')).toBe(false)
    expect(isRememberAllowed(forced, 'always')).toBe(true)
    expect(isRememberAllowed(always, 'chat')).toBe(true)
    expect(isRememberAllowed(always, 'always')).toBe(true)
    expect(isRememberAllowed(consent, 'always')).toBe(false)
  })

  it('downgrades a remember choice the matrix does not offer to once', () => {
    const native = decide(nativeTool(), { state: stateWith(['web']) })
    const consent = decide(nativeTool({ consentGate: true }))
    const forced = decide(connectorTool(), { state: stateWith(['web']) })

    expect(clampRemember(native, 'always')).toBe('once')
    expect(clampRemember(native, 'chat')).toBe('once')
    expect(clampRemember(consent, 'always')).toBe('once')
    expect(clampRemember(consent, 'chat')).toBe('chat')
    expect(clampRemember(forced, 'always')).toBe('always')
  })

  it('does not share the options array between decisions', () => {
    const first = decide(connectorTool())

    first.rememberOptions.push('once')

    expect(decide(connectorTool()).rememberOptions).toEqual([
      'once',
      'chat',
      'always',
    ])
  })
})

describe('resolveToolApproval and approval state', () => {
  it('does not change the state it reads', () => {
    const state = stateWith(['web'], ['besidka'])
    const before = serializeApprovalState(state)

    decide(connectorTool(), { state })
    decide(besidkaTool({ access: 'read' }), { state })

    expect(serializeApprovalState(state)).toEqual(before)
  })

  it('sees taint recorded between two decisions on the same state', () => {
    const state = createApprovalState()
    const descriptor = connectorTool()

    expect(decide(descriptor, { state }).rule).toBe(9)

    recordTaint(state, 'web')

    expect(decide(descriptor, { state }).rule).toBe(2)
  })

  it('does not count a counter as taint', () => {
    const state = createApprovalState()

    incrementCounter(state, 'connectorCalls', 5)

    expect(decide(nativeTool(), { state }).rule).toBe(8)
  })
})

describe('resolveReplayApproval', () => {
  const pending: ReplayPendingTool = {
    family: 'connector',
    access: 'write',
    toolName: TOOL_NAME,
    connectorId: CONNECTOR_ID,
    definitionHash: HASH,
  }
  const besidkaPending: ReplayPendingTool = {
    family: 'besidka',
    access: 'write',
    toolName: TOOL_NAME,
    definitionHash: HASH,
  }
  const nativePending: ReplayPendingTool = {
    family: 'native',
    access: 'write',
    toolName: TOOL_NAME,
  }

  function replay(
    overrides: Partial<Parameters<typeof resolveReplayApproval>[0]> = {},
  ) {
    return resolveReplayApproval({
      descriptor: connectorTool(),
      pending,
      state: createApprovalState(),
      permissionMode: 'ask',
      ...overrides,
    })
  }

  it('lets an unchanged call through as not-applicable', () => {
    const decision = replay()

    expect(decision.status).toEqual({ type: 'not-applicable' })
    expect(decision.denialReason).toBeNull()
  })

  it('never answers user-approval', () => {
    const states = [
      stateWith(['web']),
      stateWith([], ['besidka']),
      stateWith(['connector', 'skill']),
    ]

    for (const state of states) {
      expect(replay({ state }).status.type).not.toBe('user-approval')
    }
  })

  it('denies a tool that is Blocked now', () => {
    const decision = replay({ permissionMode: 'blocked' })

    expect(decision.status).toEqual({ type: 'denied', reason: 'blocked' })
    expect(decision.denialReason).toBe('blocked')
  })

  it('denies a tool that is missing from the toolset', () => {
    const decision = replay({ descriptor: null })

    expect(decision.status).toEqual({
      type: 'denied',
      reason: 'missing-tool',
    })
  })

  it('checks a missing tool before Blocked', () => {
    expect(
      replay({ descriptor: null, permissionMode: 'blocked' }).denialReason,
    ).toBe('missing-tool')
  })

  it('denies a connector tool whose definition hash drifted', () => {
    const decision = replay({
      descriptor: connectorTool({ definitionHash: OTHER_HASH }),
    })

    expect(decision.denialReason).toBe('definition-drifted')
  })

  it('denies when the pending record has no hash', () => {
    const decision = replay({ pending: { ...pending, definitionHash: null } })

    expect(decision.denialReason).toBe('definition-drifted')
  })

  it('denies when the live tool has no hash', () => {
    const decision = replay({
      descriptor: connectorTool({ definitionHash: undefined }),
    })

    expect(decision.denialReason).toBe('definition-drifted')
  })

  it('denies when the call now belongs to another connector', () => {
    const decision = replay({
      descriptor: connectorTool({ connectorId: OTHER_CONNECTOR_ID }),
    })

    expect(decision.denialReason).toBe('definition-drifted')
  })

  it('denies when the tool changed family', () => {
    const decision = replay({ descriptor: besidkaTool() })

    expect(decision.denialReason).toBe('definition-drifted')
  })

  it('compares the registry hash of a Besidka tool', () => {
    expect(replay({
      descriptor: besidkaTool(),
      pending: besidkaPending,
    }).denialReason).toBeNull()
    expect(replay({
      descriptor: besidkaTool({ definitionHash: OTHER_HASH }),
      pending: besidkaPending,
    }).denialReason).toBe('definition-drifted')
  })

  it('lets a native tool through without a hash', () => {
    const decision = replay({
      descriptor: nativeTool(),
      pending: nativePending,
    })

    expect(decision.denialReason).toBeNull()
  })

  it('denies a connector call over the per-turn cap', () => {
    const state = createApprovalState()

    incrementCounter(
      state,
      'connectorCalls',
      TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN,
    )

    expect(replay({ state }).denialReason).toBe('over-cap')
  })

  it('allows a connector call just under the per-turn cap', () => {
    const state = createApprovalState()

    incrementCounter(
      state,
      'connectorCalls',
      TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN - 1,
    )

    expect(replay({ state }).denialReason).toBeNull()
  })

  it('denies a Besidka call over the built-in cap', () => {
    const state = createApprovalState()

    incrementCounter(state, 'builtInCalls', 12)

    expect(replay({
      descriptor: besidkaTool(),
      pending: besidkaPending,
      state,
    }).denialReason).toBe('over-cap')
  })

  it('does not apply the connector cap to a Besidka call', () => {
    const state = createApprovalState()

    incrementCounter(state, 'connectorCalls', 12)

    expect(replay({
      descriptor: besidkaTool(),
      pending: besidkaPending,
      state,
    }).denialReason).toBeNull()
  })

  it('denies any call once the rounds cap is spent', () => {
    const state = createApprovalState()

    incrementCounter(state, 'rounds', 5)

    expect(replay({ state }).denialReason).toBeNull()

    incrementCounter(state, 'rounds')

    expect(replay({ state }).denialReason).toBe('over-cap')
    expect(replay({
      descriptor: nativeTool(),
      pending: nativePending,
      state,
    }).denialReason).toBe('over-cap')
  })
})

describe('resolveReplayApproval identity and fail closed', () => {
  const pending: ReplayPendingTool = {
    family: 'native',
    access: 'write',
    toolName: TOOL_NAME,
  }

  function replay(
    overrides: Partial<Parameters<typeof resolveReplayApproval>[0]> = {},
  ) {
    return resolveReplayApproval({
      descriptor: nativeTool(),
      pending,
      state: createApprovalState(),
      permissionMode: 'ask',
      ...overrides,
    })
  }

  it('denies when the access changed since the approval', () => {
    expect(replay({ descriptor: nativeTool({ access: 'delete' }) })
      .denialReason).toBe('definition-drifted')
    expect(replay({
      descriptor: connectorTool({ access: 'write' }),
      pending: {
        family: 'connector',
        access: 'read',
        toolName: TOOL_NAME,
        connectorId: CONNECTOR_ID,
        definitionHash: HASH,
      },
    }).denialReason).toBe('definition-drifted')
  })

  it('denies when the tool name changed, for every family', () => {
    expect(replay({ descriptor: nativeTool({ toolName: 'other_tool' }) })
      .denialReason).toBe('definition-drifted')
    expect(replay({
      descriptor: besidkaTool({ toolName: 'other_tool' }),
      pending: {
        family: 'besidka',
        access: 'write',
        toolName: TOOL_NAME,
        definitionHash: HASH,
      },
    }).denialReason).toBe('definition-drifted')
    expect(replay({
      descriptor: connectorTool({ toolName: 'other_tool' }),
      pending: {
        family: 'connector',
        access: 'write',
        toolName: TOOL_NAME,
        connectorId: CONNECTOR_ID,
        definitionHash: HASH,
      },
    }).denialReason).toBe('definition-drifted')
  })

  it.each([
    ['an unknown permission mode', { permissionMode: 'maybe' }],
    ['a descriptor with an empty tool name', {
      descriptor: nativeTool({ toolName: '' }),
    }],
    ['a descriptor with an unknown access', {
      descriptor: { ...nativeTool(), access: 'admin' },
    }],
    ['a descriptor without destructiveHint', {
      descriptor: { ...nativeTool(), destructiveHint: undefined },
    }],
    ['a pending record with an empty tool name', {
      pending: { ...pending, toolName: '' },
    }],
    ['a pending record with an unknown family', {
      pending: { ...pending, family: 'remote' },
    }],
    ['a pending record with an unknown access', {
      pending: { ...pending, access: 'admin' },
    }],
  ])('denies %s as invalid input', (_name, overrides) => {
    const decision = replay(
      overrides as Partial<Parameters<typeof resolveReplayApproval>[0]>,
    )

    expect(decision.status).toEqual({
      type: 'denied',
      reason: 'invalid-input',
    })
    expect(decision.denialReason).toBe('invalid-input')
  })

  it('reports a missing tool before invalid input and Blocked', () => {
    expect(replay({
      descriptor: null,
      pending: { ...pending, toolName: '' },
      permissionMode: 'blocked',
    }).denialReason).toBe('missing-tool')
  })

  it('reports invalid input before Blocked', () => {
    expect(replay({
      descriptor: nativeTool({ toolName: '' }),
      permissionMode: 'blocked',
    }).denialReason).toBe('invalid-input')
  })
})
