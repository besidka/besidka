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
      'connector',
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
      'besidka',
      'shared-branch',
    ])('asks for a Besidka write after %s taint', (kind) => {
      const decision = decide(besidkaTool(), { state: stateWith([kind]) })

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

    it.each(TOOL_APPROVAL_TAINT_KINDS)(
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

    it('is not lifted by an always grant, a chat grant or Allow', () => {
      const decision = decide(besidkaTool(), {
        state: stateWith(['web']),
        permissionMode: 'allow',
        alwaysGrant: grant({ definitionHash: HASH }),
        chatGrant: grant({ definitionHash: HASH }),
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

    it('does not apply to a connector read', () => {
      const decision = decide(connectorTool({ access: 'read' }), {
        state: stateWith(['web']),
      })

      expect(decision.rule).toBe(9)
    })
  })

  describe('rule 3, a connector call after reading another source', () => {
    it('asks when another connector was read', () => {
      const decision = decide(connectorTool({ access: 'read' }), {
        state: stateWith([], [connectorReadSource(OTHER_CONNECTOR_ID)]),
      })

      expect(decision.rule).toBe(3)
      expect(decision.reason).toBe('cross-source')
    })

    it('asks when Besidka data was read', () => {
      const decision = decide(connectorTool({ access: 'read' }), {
        state: stateWith([], ['besidka']),
      })

      expect(decision.rule).toBe(3)
    })

    it('asks when both this and another connector were read', () => {
      const decision = decide(connectorTool({ access: 'read' }), {
        state: stateWith([], [
          connectorReadSource(CONNECTOR_ID),
          connectorReadSource(OTHER_CONNECTOR_ID),
        ]),
      })

      expect(decision.rule).toBe(3)
    })

    it('does not ask when only this connector was read', () => {
      const decision = decide(connectorTool({ access: 'read' }), {
        state: stateWith([], [connectorReadSource(CONNECTOR_ID)]),
      })

      expect(decision.rule).toBe(9)
    })

    it('asks when the connector id is unknown and anything was read', () => {
      const decision = decide(
        connectorTool({ access: 'read', connectorId: undefined }),
        { state: stateWith([], [connectorReadSource(CONNECTOR_ID)]) },
      )

      expect(decision.rule).toBe(3)
    })

    it('is not lifted by an always grant or a chat grant', () => {
      const decision = decide(connectorTool({ access: 'read' }), {
        state: stateWith([], ['besidka']),
        alwaysGrant: grant({ definitionHash: HASH }),
        chatGrant: grant({ definitionHash: HASH }),
      })

      expect(decision.rule).toBe(3)
    })

    it('does not apply to Besidka tools', () => {
      const decision = decide(besidkaTool({ access: 'read' }), {
        state: stateWith([], [connectorReadSource(CONNECTOR_ID)]),
      })

      expect(decision.rule).toBe(9)
    })
  })

  describe('rule 4, a Besidka tool after untrusted content', () => {
    it('asks for a read after any taint', () => {
      const decision = decide(besidkaTool({ access: 'read' }), {
        state: stateWith(['web']),
      })

      expect(decision.rule).toBe(4)
      expect(decision.reason).toBe('untrusted-output')
    })

    it('is not lifted by Allow or grants', () => {
      const decision = decide(besidkaTool({ access: 'read' }), {
        state: stateWith(['file']),
        permissionMode: 'allow',
        alwaysGrant: grant({ definitionHash: HASH }),
      })

      expect(decision.rule).toBe(4)
    })

    it('does not apply when nothing is tainted', () => {
      const decision = decide(besidkaTool({ access: 'read' }), {
        permissionMode: 'allow',
      })

      expect(decision.rule).toBe(6)
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

    it('is not lifted by Allow, an always grant or a chat grant', () => {
      const decision = decide(besidkaTool({ access: 'delete' }), {
        permissionMode: 'allow',
        alwaysGrant: grant({ definitionHash: HASH }),
        chatGrant: grant({ definitionHash: HASH }),
      })

      expect(decision.rule).toBe(5)
    })

    it('offers only Allow once and never honors a chat grant', () => {
      const first = decide(besidkaTool({ access: 'delete' }))
      const afterChatGrant = decide(besidkaTool({ access: 'delete' }), {
        chatGrant: grant({ definitionHash: HASH }),
      })

      expect(first.rememberOptions).toEqual(['once'])
      expect(afterChatGrant.rule).toBe(5)
      expect(afterChatGrant.status.type).toBe('user-approval')
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
  it('is false only for a tool the server marks read-only', () => {
    expect(connectorDestructiveHint({ readOnlyHint: true })).toBe(false)
    expect(connectorDestructiveHint({
      readOnlyHint: true,
      destructiveHint: true,
    })).toBe(false)
  })

  it.each([
    ['no annotations', undefined],
    ['null annotations', null],
    ['empty annotations', {}],
    ['readOnlyHint false', { readOnlyHint: false }],
    ['readOnlyHint null', { readOnlyHint: null }],
    ['destructiveHint false alone', { destructiveHint: false }],
    ['destructiveHint false next to readOnlyHint false', {
      readOnlyHint: false,
      destructiveHint: false,
    }],
    ['destructiveHint true', { destructiveHint: true }],
  ])('is true for %s', (_name, annotations) => {
    expect(connectorDestructiveHint(annotations)).toBe(true)
  })

  it('never trusts destructiveHint false for a tool that may write', () => {
    const descriptor = connectorTool({
      destructiveHint: connectorDestructiveHint({ destructiveHint: false }),
    })

    expect(decide(descriptor).rule).toBe(5)
  })
})

describe('button matrix', () => {
  it.each([
    ['untrusted-output', ['once']],
    ['cross-source', ['once']],
    ['always-ask', ['once']],
    ['default', ['once', 'chat', 'always']],
  ])('offers %j remember options %j', (reason, options) => {
    const decisions = [
      decide(connectorTool(), { state: stateWith(['web']) }),
      decide(connectorTool({ access: 'read' }), {
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
    const forced = decide(connectorTool(), { state: stateWith(['web']) })
    const always = decide(besidkaTool({ access: 'delete' }))
    const defaulted = decide(connectorTool())

    expect(isRememberAllowed(forced, 'once')).toBe(true)
    expect(isRememberAllowed(forced, 'chat')).toBe(false)
    expect(isRememberAllowed(forced, 'always')).toBe(false)
    expect(isRememberAllowed(always, 'chat')).toBe(false)
    expect(isRememberAllowed(always, 'always')).toBe(false)
    expect(isRememberAllowed(defaulted, 'always')).toBe(true)
  })

  it('downgrades a remember choice the matrix does not offer to once', () => {
    const forced = decide(connectorTool(), { state: stateWith(['web']) })
    const always = decide(besidkaTool({ access: 'delete' }))
    const defaulted = decide(connectorTool())

    expect(clampRemember(forced, 'always')).toBe('once')
    expect(clampRemember(forced, 'chat')).toBe('once')
    expect(clampRemember(always, 'always')).toBe('once')
    expect(clampRemember(always, 'chat')).toBe('once')
    expect(clampRemember(defaulted, 'always')).toBe('always')
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

  it('sees taint recorded between two decisions of one step', () => {
    const state = createApprovalState()
    const descriptor = connectorTool()

    expect(decide(descriptor, { state }).rule).toBe(9)

    recordTaint(state, 'connector')

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

    incrementCounter(state, 'connectorCalls', 12)

    expect(replay({ state }).denialReason).toBe('over-cap')
  })

  it('allows a connector call just under the per-turn cap', () => {
    const state = createApprovalState()

    incrementCounter(state, 'connectorCalls', 11)

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
