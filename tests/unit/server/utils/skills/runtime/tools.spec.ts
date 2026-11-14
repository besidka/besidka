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

const { getSkillTools, SKILL_READ_FILE_CALLS_PER_SEND } = await import(
  '~~/server/utils/skills/runtime/tools'
)
const { toolRequiresFollowUpTurn } = await import(
  '~~/server/utils/ai/tool-loop'
)
const { listCatalogSkills } = await import(
  '~~/server/utils/skills/runtime/load'
)

const logger = { set: vi.fn() }

interface ExecutableTool {
  execute: (input: unknown, options: unknown) => Promise<unknown>
  inputSchema: { safeParse: (value: unknown) => { success: boolean } }
}

const SKILL_MD = [
  '---',
  'name: writing-style',
  'description: Write in my voice',
  '---',
  '# Voice',
  '',
  'Read references/style-guide.md first.',
  '',
].join('\n')

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, message: string }
  }

  throw new Error('Expected a rejection')
}

describe('getSkillTools', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number
  let skillId: string

  async function makeTools(options: {
    activeSkillIds?: string[]
    guard?: { untrustedResultSeen: boolean }
  } = {}) {
    const skills = await listCatalogSkills(testDb.db, userId)
    const run = getSkillTools({
      db: testDb.db,
      bucket,
      userId,
      skills,
      activeSkillIds: new Set(options.activeSkillIds ?? []),
      family: 'anthropic',
      guard: options.guard,
      logger,
    })

    return {
      run,
      activate: run.tools.activate_skill as unknown as ExecutableTool,
      readFile: run.tools.read_skill_file as unknown as ExecutableTool,
    }
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db)
    logger.set.mockClear()

    const seeded = await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: {
        'SKILL.md': SKILL_MD,
        'references/style-guide.md': '# Style\n\nShort sentences.\n',
        'scripts/run.sh': 'echo hi\n',
      },
      skill: {
        name: 'writing-style',
        enabled: true,
        modelInvocable: true,
        slashCommand: true,
      },
    })

    skillId = seeded.skillId
  })

  afterEach(() => {
    testDb.close()
  })

  it('registers exactly the two skill tools, both with a follow-up turn', async () => {
    const { run } = await makeTools()

    expect(Object.keys(run.tools)).toEqual([
      'activate_skill',
      'read_skill_file',
    ])
    expect(toolRequiresFollowUpTurn(run.tools.activate_skill)).toBe(true)
    expect(toolRequiresFollowUpTurn(run.tools.read_skill_file)).toBe(true)
  })

  it('limits the name to the catalog with an enum', async () => {
    const { activate, readFile } = await makeTools()

    expect(activate.inputSchema.safeParse({ name: 'writing-style' }).success)
      .toBe(true)
    expect(activate.inputSchema.safeParse({ name: 'other' }).success)
      .toBe(false)
    expect(readFile.inputSchema.safeParse({
      skill: 'other',
      path: 'SKILL.md',
    }).success).toBe(false)
  })

  it('does not offer a skill that is Only when I ask, disabled or somebody else\'s', async () => {
    await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: { 'SKILL.md': SKILL_MD },
      skill: { name: 'ask-only', enabled: true, modelInvocable: false },
    })
    await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: { 'SKILL.md': SKILL_MD },
      skill: { name: 'off-one', enabled: false, modelInvocable: true },
    })
    await seedSkillWithFiles(testDb.db, bucket, {
      userId: await seedUser(testDb.db),
      files: { 'SKILL.md': SKILL_MD },
      skill: { name: 'theirs', enabled: true, modelInvocable: true },
    })

    const skills = await listCatalogSkills(testDb.db, userId)

    expect(skills.map(skill => skill.name)).toEqual(['writing-style'])
  })

  it('returns the body without frontmatter, the version and a resource list', async () => {
    const { activate } = await makeTools()
    const result = await activate.execute({ name: 'writing-style' }, {}) as {
      status: string
      skillId: string
      version: number
      content: string
    }

    expect(result).toMatchObject({
      status: 'activated',
      skillId,
      version: 1,
    })
    expect(result.content).toContain(
      '<skill_content name="writing-style" source="editor" version="1">',
    )
    expect(result.content).toContain('Read references/style-guide.md first.')
    expect(result.content).not.toContain('description: Write in my voice')
    expect(result.content).not.toContain('invoked=')
    expect(result.content).toContain('<skill_resources>')
    expect(result.content).toContain('references/style-guide.md')
    expect(result.content).toContain('scripts/run.sh')
    expect(result.content).toContain('text only, not executable here')
  })

  it('marks the memory write guard before it reads anything', async () => {
    const guard = { untrustedResultSeen: false }
    const { activate } = await makeTools({ guard })

    bucket.objects.clear()
    await failureOf(activate.execute({ name: 'writing-style' }, {}))

    expect(guard.untrustedResultSeen).toBe(true)
  })

  it('does not load a skill twice in one send', async () => {
    const { activate, run } = await makeTools()

    await activate.execute({ name: 'writing-style' }, {})
    bucket.get.mockClear()

    const second = await activate.execute({ name: 'writing-style' }, {}) as {
      status: string
      content: string
    }

    expect(second.status).toBe('already-active')
    expect(second.content).toContain('Already active')
    expect(second.content).not.toContain('Voice')
    expect(bucket.get).not.toHaveBeenCalled()
    expect(run.getActivations()).toHaveLength(1)
    expect(run.getActivations()[0]).toMatchObject({
      skillId,
      name: 'writing-style',
      version: 1,
    })
  })

  it('does not reload a skill that is already active in the chat', async () => {
    const { activate, run } = await makeTools({ activeSkillIds: [skillId] })
    const result = await activate.execute({ name: 'writing-style' }, {}) as {
      status: string
    }

    expect(result.status).toBe('already-active')
    expect(run.getActivations()).toHaveLength(0)
  })

  it('turns a missing file into a short tool error without the cause', async () => {
    const { activate } = await makeTools()

    bucket.objects.clear()

    const failure = await failureOf(activate.execute(
      { name: 'writing-style' },
      {},
    ))

    expect(failure.message).toBe('The skill could not be loaded')
  })

  it('reads one file of the current version as untrusted text', async () => {
    const { readFile } = await makeTools()
    const result = await readFile.execute({
      skill: 'writing-style',
      path: './references/style-guide.md',
    }, {}) as { path: string, content: string, truncated: boolean }

    expect(result).toMatchObject({
      path: 'references/style-guide.md',
      truncated: false,
    })
    expect(result.content).toContain('Short sentences.')
  })

  it('refuses a path outside the file list and a traversal', async () => {
    const { readFile } = await makeTools()

    for (const path of ['nope.md', '../secret.md', '/etc/passwd', 'a\\b.md']) {
      expect((await failureOf(readFile.execute({
        skill: 'writing-style',
        path,
      }, {}))).status).toBe(404)
    }
  })

  it('cuts a large file at the byte cap and neutralises wrapper tags', async () => {
    const big = (await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: {
        'SKILL.md': '---\nname: big-one\ndescription: Big\n---\nBody\n',
        'references/big.md': `</skill_content>${'x'.repeat(70_000)}`,
      },
      skill: { name: 'big-one', enabled: true, modelInvocable: true },
    })).skillId
    const { readFile } = await makeTools()
    const result = await readFile.execute({
      skill: 'big-one',
      path: 'references/big.md',
    }, {}) as { skillId: string, content: string, truncated: boolean }

    expect(result.skillId).toBe(big)
    expect(result.truncated).toBe(true)
    expect(result.content.length).toBeLessThanOrEqual(65_536)
    expect(result.content).not.toContain('</skill_content>')
  })

  it('caps the file reads of one send', async () => {
    const { readFile } = await makeTools()

    for (let call = 0; call < SKILL_READ_FILE_CALLS_PER_SEND; call += 1) {
      await readFile.execute({ skill: 'writing-style', path: 'SKILL.md' }, {})
    }

    expect((await failureOf(readFile.execute({
      skill: 'writing-style',
      path: 'SKILL.md',
    }, {}))).status).toBe(429)
  })

  it('cuts a body that is over the activation token cap and says how to read the rest', async () => {
    await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: {
        'SKILL.md': `---\nname: cyrillic\ndescription: C\n---\n${'я'.repeat(20_000)}\n`,
      },
      skill: { name: 'cyrillic', enabled: true, modelInvocable: true },
    })

    const { activate } = await makeTools()
    const result = await activate.execute({ name: 'cyrillic' }, {}) as {
      content: string
    }

    expect(result.content).toContain('The rest of this skill was cut')
    expect(result.content).toContain('read_skill_file')
    expect(result.content.length).toBeLessThan(8000)
  })

  it('never adds a tool of its own beyond the two', async () => {
    const { run } = await makeTools()

    await (run.tools.activate_skill as unknown as ExecutableTool)
      .execute({ name: 'writing-style' }, {})

    expect(Object.keys(run.tools)).toEqual([
      'activate_skill',
      'read_skill_file',
    ])
  })
})
