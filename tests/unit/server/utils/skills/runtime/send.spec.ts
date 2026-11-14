import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
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

  it('locks the memory write for a catalog that lists an imported skill, not for authored ones only', async () => {
    const authored = await prepare()

    expect(authored.holdsSkillText).toBe(false)

    const importedId = await seed('imported-skill', 'IMPORTED BODY', {
      modelInvocable: true,
    })

    for (const sourceKind of ['zip', 'text', 'github', 'url', 'mcp', 'share']) {
      await testDb.db.update(schema.skills)
        .set({ sourceKind })
        .where(eq(schema.skills.id, importedId))

      const result = await prepare()

      expect(result.instructionBlock).toContain('- imported-skill:')
      expect(result.holdsSkillText).toBe(true)
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
      userMessageText: 'summarise this',
    })

    expect(result.toolsRegistered).toBe(false)
    expect(result.invocationBlock).toContain('ASK BODY summarise this')
    expect(result.instructionBlock).toBeNull()
    expect(result.holdsSkillText).toBe(true)

    const turns = appendTextToLastUserTurn([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'summarise this' }] },
    ], result.invocationBlock!)

    expect(turns[0]!.parts.at(-1)).toMatchObject({
      type: 'text',
      text: expect.stringContaining('ASK BODY summarise this'),
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
})
