import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JEV_SEND_PATH_TIMEOUT_MS } from '#shared/utils/jev-policy'

const mocks = vi.hoisted(() => ({
  jevDecide: vi.fn(),
  resolveJevRoleModel: vi.fn(),
  isFeatureActive: vi.fn(),
  listCatalogSkills: vi.fn(),
  listProjectRuntimeSkills: vi.fn(),
}))

vi.mock('~~/server/utils/jev/client', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/jev/client')
  >()

  return { ...actual, jevDecide: mocks.jevDecide }
})

vi.mock('~~/server/utils/jev/roles', () => ({
  resolveJevRoleModel: mocks.resolveJevRoleModel,
}))

vi.mock('~~/server/utils/features/send-features', () => ({
  resolveSendFeatures: async () => ({
    isFeatureActive: mocks.isFeatureActive,
  }),
}))

vi.mock('~~/server/utils/skills/runtime/load', () => ({
  listCatalogSkills: mocks.listCatalogSkills,
  listProjectRuntimeSkills: mocks.listProjectRuntimeSkills,
}))

const { prepareSkillSelection, resolveSkillSelection } = await import(
  '~~/server/utils/skills/jev/selection'
)

const MODEL = { id: 'jev-model' } as never

function skillRow(id: string, name: string, description: string) {
  return {
    id,
    name,
    description,
    currentVersion: 2,
    sourceKind: 'app',
    enabled: true,
    modelInvocable: true,
  }
}

const ROWS = [
  skillRow('s-notes', 'meeting-notes', 'Turns a meeting transcript into '
  + 'structured minutes with decisions and action items.'),
  skillRow('s-sql', 'sql-review', 'Reviews SQL queries for correctness and '
  + 'indexes.'),
  skillRow('s-commit', 'commit-message-writer', 'Writes Conventional '
  + 'Commits messages from a git diff.'),
]

function createLogger() {
  const attributes: Record<string, any> = {}

  return {
    attributes,
    logger: {
      set: (fields: Record<string, any>) => {
        Object.assign(attributes, fields.attributes ?? {})
      },
      getContext: () => ({ attributes }),
    },
  }
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    event: { context: {} } as never,
    db: {} as never,
    userId: 7,
    projectId: null,
    isResume: false,
    messageText: 'Turn this meeting transcript into minutes with action items',
    newMessageParts: [{ type: 'text', text: 'x' }],
    storedMessages: [],
    logger: createLogger().logger,
    ...overrides,
  } as Parameters<typeof prepareSkillSelection>[0]
}

function jevAnswer(probabilities: Record<string, number>) {
  return {
    ok: true as const,
    status: 'ok' as const,
    probabilities,
    inputTokens: 500,
    latencyMs: 120,
  }
}

beforeEach(() => {
  mocks.jevDecide.mockReset().mockResolvedValue(jevAnswer({ sel_0: 0.95 }))
  mocks.resolveJevRoleModel.mockReset().mockResolvedValue(MODEL)
  mocks.isFeatureActive.mockReset().mockReturnValue(true)
  mocks.listCatalogSkills.mockReset().mockResolvedValue(ROWS)
  mocks.listProjectRuntimeSkills.mockReset().mockResolvedValue([])
})

describe('prepareSkillSelection', () => {
  it('builds a plan with the matching skill and its questions', async () => {
    const plan = await prepareSkillSelection(baseInput())

    expect(plan).not.toBeNull()
    expect(plan!.candidates.map(skill => skill.id)).toEqual(['s-notes'])
    expect(plan!.catalogSkills).toEqual(ROWS)
    expect(Object.keys(plan!.extraJev!.questions)).toEqual(['sel_0'])
    expect(plan!.extraJev!.state.skill_0).toContain('meeting-notes: Turns')
    expect(plan!.model).toBe(MODEL)
    expect(mocks.resolveJevRoleModel).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, role: 'skillSelection' }),
    )
    expect(mocks.jevDecide).not.toHaveBeenCalled()
  })

  it('keeps no candidate and no questions when no skill matches, and calls '
    + 'nothing', async () => {
    const plan = await prepareSkillSelection(baseInput({
      messageText: 'What is the capital of Australia?',
    }))

    expect(plan!.candidates).toEqual([])
    expect(plan!.extraJev).toBeNull()
    expect(plan!.catalogSkills).toEqual(ROWS)
    expect(await resolveSkillSelection(plan)).toBeNull()
    expect(mocks.jevDecide).not.toHaveBeenCalled()
  })

  it('does nothing for a resume, an empty message or an attached skill',
    async () => {
      expect(await prepareSkillSelection(baseInput({ isResume: true })))
        .toBeNull()
      expect(await prepareSkillSelection(baseInput({ messageText: '  ' })))
        .toBeNull()
      expect(await prepareSkillSelection(baseInput({ messageText: null })))
        .toBeNull()
      expect(await prepareSkillSelection(baseInput({
        newMessageParts: [{
          type: 'data-skill-invocation',
          data: { skillId: 's-sql', name: 'sql-review', version: 1 },
        }],
      }))).toBeNull()
      expect(mocks.listCatalogSkills).not.toHaveBeenCalled()
      expect(mocks.resolveJevRoleModel).not.toHaveBeenCalled()
    })

  it('reads nothing when the skills flag is off', async () => {
    mocks.isFeatureActive.mockReturnValue(false)

    expect(await prepareSkillSelection(baseInput())).toBeNull()
    expect(mocks.listCatalogSkills).not.toHaveBeenCalled()
    expect(mocks.resolveJevRoleModel).not.toHaveBeenCalled()
  })

  it('returns null before reading the catalog when the role is off or '
    + 'there is no key', async () => {
    mocks.resolveJevRoleModel.mockResolvedValue(null)

    expect(await prepareSkillSelection(baseInput())).toBeNull()
    expect(mocks.listCatalogSkills).not.toHaveBeenCalled()
    expect(mocks.listProjectRuntimeSkills).not.toHaveBeenCalled()
  })

  it('skips skills already active in the chat', async () => {
    const plan = await prepareSkillSelection(baseInput({
      storedMessages: [{
        role: 'assistant',
        parts: [{
          type: 'data-skill-activation',
          data: { skillId: 's-notes', name: 'meeting-notes', version: 2 },
        }],
      }],
    }))

    expect(plan!.candidates).toEqual([])
    expect(plan!.extraJev).toBeNull()
  })

  it('still offers a skill whose activation came from a project pin',
    async () => {
      const plan = await prepareSkillSelection(baseInput({
        storedMessages: [{
          role: 'assistant',
          parts: [{
            type: 'data-skill-activation',
            data: {
              skillId: 's-notes',
              name: 'meeting-notes',
              version: 2,
              source: 'project',
            },
          }],
        }],
      }))

      expect(plan!.candidates.map(skill => skill.id)).toEqual(['s-notes'])
    })

  it('skips skills the project pins to always load, keeps prefer ones',
    async () => {
      mocks.listProjectRuntimeSkills.mockResolvedValue([
        { ...ROWS[0], level: 'always', position: 0 },
        { ...ROWS[1], level: 'prefer', position: 1 },
      ])

      const none = await prepareSkillSelection(baseInput({
        projectId: 'p-1',
      }))
      const sql = await prepareSkillSelection(baseInput({
        projectId: 'p-1',
        messageText: 'Review this SQL query for indexes',
      }))

      expect(none!.candidates).toEqual([])
      expect(sql!.candidates.map(skill => skill.id)).toEqual(['s-sql'])
    })

  it('offers a skill TypeSafe AI picked on an earlier send again', async () => {
    const plan = await prepareSkillSelection(baseInput({
      storedMessages: [{
        role: 'assistant',
        parts: [{
          type: 'data-skill-activation',
          data: {
            skillId: 's-notes',
            name: 'meeting-notes',
            version: 2,
            source: 'jev',
          },
        }],
      }],
    }))

    expect(plan!.candidates.map(skill => skill.id)).toEqual(['s-notes'])
  })

  it('does not read project pins outside a project', async () => {
    await prepareSkillSelection(baseInput())

    expect(mocks.listProjectRuntimeSkills).not.toHaveBeenCalled()
  })

  it('fails open when a read throws', async () => {
    const { attributes, logger } = createLogger()

    mocks.listCatalogSkills.mockRejectedValue(new Error('D1 down'))

    expect(await prepareSkillSelection(baseInput({ logger }))).toBeNull()
    expect(attributes.skills.selectionPrepareError).toBe('D1 down')
  })
})

describe('resolveSkillSelection', () => {
  it('returns null for no plan, with no call', async () => {
    expect(await resolveSkillSelection(null)).toBeNull()
    expect(mocks.jevDecide).not.toHaveBeenCalled()
  })

  it('makes the one call itself and returns the winner', async () => {
    const { attributes, logger } = createLogger()
    const plan = await prepareSkillSelection(baseInput({ logger }))
    const selected = await resolveSkillSelection(plan)

    expect(selected).toEqual({
      skillId: 's-notes',
      name: 'meeting-notes',
      version: 2,
    })
    expect(mocks.jevDecide).toHaveBeenCalledTimes(1)

    const call = mocks.jevDecide.mock.calls[0]![0]

    expect(call.model).toBe(MODEL)
    expect(call.timeoutMs).toBe(JEV_SEND_PATH_TIMEOUT_MS)
    expect(Object.keys(call.questions)).toEqual(['sel_0'])
    expect(call.state.skill_0).toContain('meeting-notes')
    expect(call.state.message).toContain('meeting transcript')
    expect(JSON.stringify(call.questions)).not.toContain('meeting transcript')
    expect(attributes.skillSelectionJev).toMatchObject({
      status: 'ok',
      calls: 1,
      questions: 1,
      inputTokens: 500,
      latencyMs: 120,
      counts: { candidates: 1, shared: 0, applied: 1 },
      scores: [0.95],
    })
    expect(JSON.stringify(attributes)).not.toContain('Turns a meeting')
  })

  it('picks the best of several candidates at or above the threshold',
    async () => {
      const plan = await prepareSkillSelection(baseInput({
        messageText: 'review the sql, write commit messages and meeting '
          + 'notes',
      }))

      expect(plan!.candidates.length).toBe(3)

      mocks.jevDecide.mockResolvedValue(jevAnswer({
        sel_0: 0.3,
        sel_1: 0.65,
        sel_2: 0.9,
      }))

      const selected = await resolveSkillSelection(plan)

      expect(selected?.skillId).toBe(plan!.candidates[2]!.id)
    })

  it('applies nothing below the threshold', async () => {
    const { attributes, logger } = createLogger()
    const plan = await prepareSkillSelection(baseInput({ logger }))

    mocks.jevDecide.mockResolvedValue(jevAnswer({ sel_0: 0.59 }))

    expect(await resolveSkillSelection(plan)).toBeNull()
    expect(attributes.skillSelectionJev.counts.applied).toBe(0)
  })

  it.each([
    ['timeout'],
    ['rate-limited'],
    ['unauthorized'],
    ['network'],
    ['error'],
  ] as const)('changes nothing on a %s failure', async (status) => {
    const { attributes, logger } = createLogger()
    const plan = await prepareSkillSelection(baseInput({ logger }))

    mocks.jevDecide.mockResolvedValue({ ok: false, status, latencyMs: 800 })

    expect(await resolveSkillSelection(plan)).toBeNull()
    expect(attributes.skillSelectionJev).toMatchObject({ status, calls: 1 })
  })

  it('changes nothing when the call throws unexpectedly', async () => {
    const { attributes, logger } = createLogger()
    const plan = await prepareSkillSelection(baseInput({ logger }))

    mocks.jevDecide.mockRejectedValue(new Error('boom'))

    expect(await resolveSkillSelection(plan)).toBeNull()
    expect(attributes.skillSelectionJev.status).toBe('error')
  })

  it('reuses the send-path result and makes no call of its own', async () => {
    const { attributes, logger } = createLogger()
    const plan = await prepareSkillSelection(baseInput({ logger }))
    const selected = await resolveSkillSelection(
      plan,
      jevAnswer({ sel_0: 0.9, w1_live: 0.01 }),
    )

    expect(selected?.skillId).toBe('s-notes')
    expect(mocks.jevDecide).not.toHaveBeenCalled()
    expect(attributes.skillSelectionJev).toMatchObject({
      status: 'ok',
      calls: 0,
      counts: { shared: 1, applied: 1 },
    })
    expect(attributes.skillSelectionJev.inputTokens).toBeUndefined()
  })

  it('does not ask again when the shared call failed', async () => {
    const plan = await prepareSkillSelection(baseInput())
    const selected = await resolveSkillSelection(plan, {
      ok: false,
      status: 'timeout',
      latencyMs: 800,
    })

    expect(selected).toBeNull()
    expect(mocks.jevDecide).not.toHaveBeenCalled()
  })

  it('applies nothing when the shared result has no skill answer', async () => {
    const plan = await prepareSkillSelection(baseInput())

    expect(await resolveSkillSelection(plan, jevAnswer({ w1_live: 0.9 })))
      .toBeNull()
  })
})
