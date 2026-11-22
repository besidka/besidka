import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedProject,
  seedUser,
} from '../../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  seedSkillWithFiles,
} from '../../../../../setup/helpers/skills-db'
import type { FakeSkillBucket } from '../../../../../setup/helpers/skills-db'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const schema = await import('~~/server/db/schema')
const { eq } = await import('drizzle-orm')
const { prepareSkillsForSend } = await import(
  '~~/server/utils/skills/runtime/send'
)
const { appendTextToLastUserTurn } = await import(
  '~~/server/utils/chats/model-turns'
)

const logger = { set: vi.fn() }

function skillMd(name: string, body: string) {
  return `---\nname: ${name}\ndescription: About ${name}\n---\n${body}\n`
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

describe('prepareSkillsForSend', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number
  let autoId: string
  let askId: string

  async function seed(
    name: string,
    body: string,
    skill: Record<string, unknown>,
  ) {
    return (await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: { 'SKILL.md': skillMd(name, body) },
      skill: {
        name,
        description: `About ${name}`,
        enabled: true,
        ...skill,
      },
    })).skillId
  }

  function prepare(
    overrides: Partial<Parameters<typeof prepareSkillsForSend>[0]> = {},
  ) {
    return prepareSkillsForSend({
      db: testDb.db,
      getBucket: () => bucket,
      userId,
      isSkillsActive: true,
      isToolCallingAllowed: true,
      family: 'anthropic',
      storedMessages: [],
      newMessageParts: [{ type: 'text', text: 'hello' }],
      userMessageText: 'hello',
      isStoredUserMessage: false,
      logger,
      ...overrides,
    })
  }

  function invocation(skillId: string, name: string) {
    return { type: 'data-skill-invocation', data: { skillId, name, version: 1 } }
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db)
    logger.set.mockClear()
    autoId = await seed('auto-skill', 'AUTO BODY $ARGUMENTS', {
      modelInvocable: true,
      slashCommand: true,
    })
    askId = await seed('ask-skill', 'ASK BODY $ARGUMENTS', {
      modelInvocable: false,
      slashCommand: true,
    })
  })

  afterEach(() => {
    testDb.close()
  })

  it('adds nothing and reads nothing when the flag is off', async () => {
    const getBucket = vi.fn(() => bucket)
    const result = await prepare({
      isSkillsActive: false,
      getBucket,
      newMessageParts: [invocation(autoId, 'auto-skill')],
    })

    expect(result.toolsRegistered).toBe(false)
    expect(result.tools).toEqual({})
    expect(result.instructionBlock).toBeNull()
    expect(result.invocationBlock).toBeNull()
    expect(result.holdsSkillText).toBe(false)
    expect(getBucket).not.toHaveBeenCalled()
    expect(bucket.get).not.toHaveBeenCalled()
  })

  it('lists only model-invocable skills in the catalog and registers the tools', async () => {
    const result = await prepare()

    expect(result.toolsRegistered).toBe(true)
    expect(Object.keys(result.tools)).toEqual([
      'activate_skill',
      'read_skill_file',
    ])
    expect(result.instructionBlock).toContain('- auto-skill: About auto-skill')
    expect(result.instructionBlock).not.toContain('ask-skill')
    expect(result.holdsSkillText).toBe(false)
  })

  it('does not taint the send for a catalog that lists an imported skill: only its body would', async () => {
    const importedId = await seed('imported-skill', 'IMPORTED BODY', {
      modelInvocable: true,
    })

    for (const sourceKind of ['zip', 'text', 'github', 'url', 'mcp', 'share']) {
      await testDb.db.update(schema.skills)
        .set({ sourceKind })
        .where(eq(schema.skills.id, importedId))

      const result = await prepare()

      expect(result.instructionBlock).toContain('- imported-skill:')
      expect(result.instructionBlock).not.toContain('IMPORTED BODY')
      expect(result.holdsSkillText).toBe(false)
    }
  })

  it('keeps the lock off for template skills and for an imported skill that is not in the catalog', async () => {
    await seed('from-template', 'T', { modelInvocable: true, sourceKind: 'template' })
    await seed('imported-ask', 'A', {
      modelInvocable: false,
      sourceKind: 'zip',
    })

    expect((await prepare()).holdsSkillText).toBe(false)
  })

  it('does not lock for an imported skill when tool calling is off and no catalog is built', async () => {
    await seed('imported-auto', 'A', { modelInvocable: true, sourceKind: 'zip' })

    const result = await prepare({ isToolCallingAllowed: false })

    expect(result.instructionBlock).toBeNull()
    expect(result.holdsSkillText).toBe(false)
  })

  it('registers no tool and no catalog when the user has no model-invocable skill', async () => {
    await testDb.db.update(schema.skills)
      .set({ modelInvocable: false })

    const result = await prepare()

    expect(result.toolsRegistered).toBe(false)
    expect(result.tools).toEqual({})
    expect(result.instructionBlock).toBeNull()
  })

  it('adds no catalog and no tools when the model cannot call tools', async () => {
    const result = await prepare({ isToolCallingAllowed: false })

    expect(result.toolsRegistered).toBe(false)
    expect(result.tools).toEqual({})
    expect(result.instructionBlock).toBeNull()
  })

  it('injects an attached skill without tools, and never into the system prompt', async () => {
    const result = await prepare({
      isToolCallingAllowed: false,
      newMessageParts: [invocation(askId, 'ask-skill')],
      userMessageText: 'summarize this',
    })

    expect(result.toolsRegistered).toBe(false)
    expect(result.invocationBlock).toContain('ASK BODY summarize this')
    expect(result.instructionBlock).toBeNull()
    expect(result.holdsSkillText).toBe(true)

    const turns = appendTextToLastUserTurn([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'summarize this' }] },
    ], result.invocationBlock!)

    expect(turns[0]!.parts.at(-1)).toMatchObject({
      type: 'text',
      text: expect.stringContaining('ASK BODY summarize this'),
    })
  })

  it('runs an Only when I ask skill once: no activation part, not re-injected later', async () => {
    const result = await prepare({
      newMessageParts: [invocation(askId, 'ask-skill')],
    })

    expect(result.streamActivations).toEqual([])
    expect(result.activeSkillsBlock).toBeNull()

    const later = await prepare({
      storedMessages: [
        { role: 'user', parts: [invocation(askId, 'ask-skill')] },
        { role: 'assistant', parts: [{ type: 'text', text: 'done' }] },
      ],
    })

    expect(later.invocationBlock).toBeNull()
    expect(later.activeSkillsBlock).toBeNull()
  })

  it('keeps an attached Auto skill active, through an activation part', async () => {
    const result = await prepare({
      newMessageParts: [invocation(autoId, 'auto-skill')],
    })

    expect(result.streamActivations).toHaveLength(1)
    expect(result.streamActivations[0]).toMatchObject({
      type: 'data-skill-activation',
      data: { skillId: autoId, name: 'auto-skill', version: 1 },
    })

    const later = await prepare({
      storedMessages: [
        { role: 'assistant', parts: [result.streamActivations[0]!] },
      ],
    })

    expect(later.activeSkillsBlock).toContain('AUTO BODY')
    expect(later.instructionBlock).toContain('<active_skills>')
    expect(later.holdsSkillText).toBe(true)
  })

  it('re-injects activations even when tool calling is off, without the catalog', async () => {
    const result = await prepare({
      isToolCallingAllowed: false,
      storedMessages: [{
        role: 'assistant',
        parts: [{
          type: 'data-skill-activation',
          data: { skillId: autoId, name: 'auto-skill', version: 1 },
        }],
      }],
    })

    expect(result.activeSkillsBlock).toContain('AUTO BODY')
    expect(result.instructionBlock).not.toContain('<available_skills>')
    expect(result.toolsRegistered).toBe(false)
  })

  it('does not inject the attached skill twice when it is also in the re-injected list', async () => {
    const result = await prepare({
      newMessageParts: [invocation(autoId, 'auto-skill')],
      storedMessages: [{
        role: 'assistant',
        parts: [{
          type: 'data-skill-activation',
          data: { skillId: autoId, name: 'auto-skill', version: 1 },
        }],
      }],
    })

    expect(result.invocationBlock).toContain('AUTO BODY')
    expect(result.activeSkillsBlock).toBeNull()
  })

  it('fails a new message with the generic 400 when the attached skill cannot be read', async () => {
    bucket.objects.clear()

    const failure = await failureOf(prepare({
      newMessageParts: [invocation(askId, 'ask-skill')],
    }))

    expect(failure).toMatchObject({
      status: 400,
      code: 'skill_invocation_unavailable',
    })
  })

  it('uses a preloaded invocation and does not read the skill twice', async () => {
    const { loadSkillInvocationContent } = await import(
      '~~/server/utils/skills/runtime/invocation'
    )
    const preloaded = await loadSkillInvocationContent({
      db: testDb.db,
      bucket,
      userId,
      invocation: { skillId: askId, name: 'ask-skill', version: 1 },
    })

    bucket.get.mockClear()

    const result = await prepare({
      newMessageParts: [invocation(askId, 'ask-skill')],
      userMessageText: 'go',
      preloadedInvocation: preloaded,
    })

    expect(preloaded).not.toBeNull()
    expect(result.invocationBlock).toContain('ASK BODY go')
    expect(bucket.get).not.toHaveBeenCalled()
  })

  it('lets a stored message run without a skill that can no longer be read', async () => {
    bucket.objects.clear()

    const result = await prepare({
      isStoredUserMessage: true,
      newMessageParts: [invocation(askId, 'ask-skill')],
    })

    expect(result.invocationBlock).toBeNull()
  })

  describe('skill picked by TypeSafe AI', () => {
    function selection(skillId: string, name: string) {
      return { skillId, name, version: 1 }
    }

    it('injects the picked skill like an attachment, worded as Besidka\'s match', async () => {
      const result = await prepare({
        jevSelection: selection(autoId, 'auto-skill'),
      })

      expect(result.invocationBlock).toContain('Besidka matched the skill')
      expect(result.invocationBlock).not.toContain('The user attached')
      expect(result.invocationBlock).toContain('invoked="jev"')
      expect(result.invocationBlock).toContain('AUTO BODY hello')
      expect(result.holdsSkillText).toBe(true)
      expect(result.instructionBlock).not.toContain('AUTO BODY')
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          skills: expect.objectContaining({ selectedByJev: true }),
        },
      })
    })

    it('shows as a skill step but applies to this send only, not later ones', async () => {
      const result = await prepare({
        jevSelection: selection(autoId, 'auto-skill'),
      })

      expect(result.streamActivations).toHaveLength(1)
      expect(result.streamActivations[0]).toMatchObject({
        type: 'data-skill-activation',
        data: { skillId: autoId, version: 1, source: 'jev' },
      })

      const later = await prepare({
        storedMessages: [
          { role: 'assistant', parts: [result.streamActivations[0]!] },
        ],
      })

      expect(later.activeSkillsBlock).toBeNull()
      expect(later.invocationBlock).toBeNull()
      expect(later.instructionBlock).not.toContain('AUTO BODY')
      expect(later.instructionBlock).not.toContain('<active_skills>')
    })

    it('reads the preloaded catalog instead of the database', async () => {
      const skills = await import('~~/server/utils/skills/runtime/load')
      const listed = await skills.listCatalogSkills(testDb.db, userId)
      const result = await prepare({
        preloadedCatalogSkills: [],
      })

      expect(listed.length).toBeGreaterThan(0)
      expect(result.toolsRegistered).toBe(false)
      expect(result.instructionBlock).toBeNull()
    })

    it('marks the skill active for the tools, so activate_skill answers already active', async () => {
      const result = await prepare({
        jevSelection: selection(autoId, 'auto-skill'),
      })

      expect(result.toolsRegistered).toBe(true)
      expect(result.activeSkillsBlock).toBeNull()
    })

    it('works without tool calling', async () => {
      const result = await prepare({
        isToolCallingAllowed: false,
        jevSelection: selection(autoId, 'auto-skill'),
      })

      expect(result.toolsRegistered).toBe(false)
      expect(result.invocationBlock).toContain('AUTO BODY')
    })

    it('never overrides a skill the user attached', async () => {
      const result = await prepare({
        newMessageParts: [invocation(askId, 'ask-skill')],
        jevSelection: selection(autoId, 'auto-skill'),
      })

      expect(result.invocationBlock).toContain('ASK BODY')
      expect(result.invocationBlock).not.toContain('AUTO BODY')
      expect(result.invocationBlock).toContain('The user attached')
      expect(result.streamActivations).toEqual([])
    })

    it('skips a picked skill that cannot be read, without an error', async () => {
      bucket.objects.clear()

      const result = await prepare({
        jevSelection: selection(autoId, 'auto-skill'),
      })

      expect(result.invocationBlock).toBeNull()
      expect(result.streamActivations).toEqual([])
    })

    it('does nothing for a skill that is no longer runnable', async () => {
      await testDb.db.update(schema.skills)
        .set({ enabled: false })
        .where(eq(schema.skills.id, autoId))

      const result = await prepare({
        jevSelection: selection(autoId, 'auto-skill'),
      })

      expect(result.invocationBlock).toBeNull()
    })
  })

  it('sets the memory guard only through the tools, never at preparation', async () => {
    const guard = { untrustedResultSeen: false }

    await prepare({ guard })

    expect(guard.untrustedResultSeen).toBe(false)
  })

  it('offers the attached Only when I ask skill to read_skill_file as well when the catalog exists', async () => {
    const result = await prepare({
      newMessageParts: [invocation(askId, 'ask-skill')],
    })
    const readFile = result.tools.read_skill_file as unknown as {
      inputSchema: { safeParse: (value: unknown) => { success: boolean } }
    }

    expect(readFile.inputSchema.safeParse({
      skill: 'ask-skill',
      path: 'SKILL.md',
    }).success).toBe(true)
  })

  describe('project skills', () => {
    let projectId: string
    let position: number

    async function pin(skillId: string, level: 'always' | 'prefer') {
      await testDb.db.insert(schema.projectSkills).values({
        projectId,
        skillId,
        userId,
        level,
        position: position++,
      })
    }

    beforeEach(async () => {
      projectId = await seedProject(testDb.db, userId)
      position = 0
    })

    it('adds nothing for a project without pins', async () => {
      const result = await prepare({ projectId })

      expect(result.instructionBlock).not.toContain('<project_skills>')
      expect(result.streamActivations).toEqual([])
    })

    it('loads an always skill in every send, also without tool calling', async () => {
      await pin(askId, 'always')

      const withTools = await prepare({ projectId })
      const withoutTools = await prepare({
        projectId,
        isToolCallingAllowed: false,
      })

      for (const result of [withTools, withoutTools]) {
        expect(result.instructionBlock).toContain('ASK BODY')
        expect(result.activeSkillsBlock).toContain('ASK BODY')
        expect(result.holdsSkillText).toBe(true)
        expect(result.streamActivations).toEqual([
          expect.objectContaining({
            type: 'data-skill-activation',
            data: expect.objectContaining({
              skillId: askId,
              source: 'project',
            }),
          }),
        ])
      }

      expect(withoutTools.toolsRegistered).toBe(false)
    })

    it('keeps an always skill out of the catalog and registers no tools without one', async () => {
      await pin(autoId, 'always')

      const result = await prepare({ projectId })

      expect(result.instructionBlock).toContain('AUTO BODY')
      expect(result.instructionBlock).not.toContain('- auto-skill:')
      expect(result.toolsRegistered).toBe(false)
    })

    it('lets the model read the files of an always skill when a catalog exists', async () => {
      await pin(askId, 'always')

      const result = await prepare({ projectId })
      const readFile = result.tools.read_skill_file as unknown as {
        inputSchema: { safeParse: (value: unknown) => { success: boolean } }
      }
      const activate = result.tools.activate_skill as unknown as {
        inputSchema: { safeParse: (value: unknown) => { success: boolean } }
      }

      expect(result.toolsRegistered).toBe(true)
      expect(result.instructionBlock).toContain('ASK BODY')
      expect(result.instructionBlock).not.toContain('- ask-skill')
      expect(readFile.inputSchema.safeParse({
        skill: 'ask-skill',
        path: 'SKILL.md',
      }).success).toBe(true)
      expect(activate.inputSchema.safeParse({ name: 'ask-skill' }).success)
        .toBe(true)
    })

    it('lists a prefer skill first with the marker, even in Only when I ask', async () => {
      await pin(askId, 'prefer')

      const result = await prepare({ projectId })

      expect(result.toolsRegistered).toBe(true)
      expect(result.instructionBlock).not.toContain('ASK BODY')
      expect(result.instructionBlock!.indexOf('- ask-skill (project\'s choice)'))
        .toBeLessThan(result.instructionBlock!.indexOf('- auto-skill:'))
      expect(result.streamActivations).toEqual([])
    })

    it('never loads an Off pinned skill', async () => {
      const off = await seed('off-skill', 'OFF BODY', { enabled: false })

      await pin(off, 'always')

      const result = await prepare({ projectId })

      expect(result.instructionBlock).not.toContain('OFF BODY')
      expect(result.holdsSkillText).toBe(false)
    })

    it('lets the skill the user attached win over the same project pin', async () => {
      await pin(askId, 'always')

      const result = await prepare({
        projectId,
        newMessageParts: [invocation(askId, 'ask-skill')],
      })

      expect(result.invocationBlock).toContain('ASK BODY')
      expect(result.instructionBlock).not.toContain('invoked="project"')
      expect(result.streamActivations).toEqual([])
    })

    it('does not apply another project\'s pins', async () => {
      const otherProject = await seedProject(testDb.db, userId)

      await testDb.db.insert(schema.projectSkills).values({
        projectId: otherProject,
        skillId: askId,
        userId,
        level: 'always',
        position: 0,
      })

      const result = await prepare({ projectId })

      expect(result.instructionBlock).not.toContain('ASK BODY')
    })

    it('does not re-inject a project skill from stored project activations', async () => {
      const result = await prepare({
        projectId,
        storedMessages: [{
          role: 'assistant',
          parts: [{
            type: 'data-skill-activation',
            data: {
              skillId: autoId,
              name: 'auto-skill',
              version: 1,
              source: 'project',
            },
          }],
        }],
      })

      expect(result.activeSkillsBlock).toBeNull()
    })

    it('keeps an activated prefer skill active on the next send in Only when I ask', async () => {
      await pin(askId, 'prefer')

      const result = await prepare({
        projectId,
        storedMessages: [{
          role: 'assistant',
          parts: [{
            type: 'data-skill-activation',
            data: { skillId: askId, name: 'ask-skill', version: 1 },
          }],
        }],
      })

      expect(result.activeSkillsBlock).toContain('ASK BODY')
    })
  })
})
