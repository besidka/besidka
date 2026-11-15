import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SKILL_SCRIPTS_GATE_TOOL_NAME,
  SKILL_SCRIPTS_GRANT_KEY,
  hashSkillScriptsSet,
} from '#shared/utils/skills/scripts'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  seedSkillWithFiles,
} from '../../../../setup/helpers/skills-db'
import type { FakeSkillBucket } from '../../../../setup/helpers/skills-db'

const mocks = vi.hoisted(() => ({
  logger: { set: vi.fn() },
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const {
  SKILL_SCRIPTS_ALLOWED_TEXT,
  SKILL_SCRIPTS_UPLOAD_FAILED_TEXT,
  buildSkillScriptsInstruction,
  prepareSkillScriptsForSend,
} = await import('~~/server/utils/skills/send-container-options')
const { addBesidkaChatGrant } = await import(
  '~~/server/utils/besidka-tools/chat-settings'
)

const SKILL_MD = '---\nname: data-report\ndescription: d\n---\nBody\n'

describe('prepareSkillScriptsForSend', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number
  let chatPublicId: string

  async function seedSkill(
    name: string,
    overrides: Partial<{
      allowScripts: boolean
      enabled: boolean
      status: 'ready' | 'needs-review' | 'broken'
      licenseClass: 'authored' | 'open' | 'restricted'
      files: Record<string, string>
    }> = {},
  ) {
    const { files, ...skill } = overrides
    const { skillId } = await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files: files ?? {
        'SKILL.md': SKILL_MD.replace('data-report', name),
        'scripts/run.py': 'print(1)\n',
      },
      skill: { name, allowScripts: true, enabled: true, ...skill },
    })

    return skillId
  }

  function prepare(
    input: Partial<Parameters<typeof prepareSkillScriptsForSend>[0]>,
  ) {
    return prepareSkillScriptsForSend({
      db: testDb.db,
      getBucket: () => bucket,
      userId,
      chatPublicId,
      candidateSkillIds: [],
      isFeatureActive: true,
      isApprovalsActive: true,
      isToolCallingAllowed: true,
      isDirectAnthropic: true,
      isCodeExecutionActive: true,
      apiKey: 'sk-ant-test',
      logger: mocks.logger,
      uploader: vi.fn(async () => {
        return { providerSkillId: 'skill_01', latestVersion: '1759178010' }
      }),
      ...input,
    })
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db, null)
    chatPublicId = (await seedChat(testDb.db, userId)).id
    vi.stubGlobal('useDb', () => testDb.db)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('preconditions', () => {
    it.each([
      ['the flag or Labs opt-in is off', { isFeatureActive: false }],
      ['tool approvals are off', { isApprovalsActive: false }],
      ['tool calling is off', { isToolCallingAllowed: false }],
      ['the route is a gateway or not Anthropic', { isDirectAnthropic: false }],
      ['Run code is off for the message', { isCodeExecutionActive: false }],
      ['there is no user key', { apiKey: null }],
    ])('is inactive when %s', async (_label, override) => {
      const skillId = await seedSkill('data-report')
      const run = await prepare({ candidateSkillIds: [skillId], ...override })

      expect(run.gate.isActive).toBe(false)
      expect(run.gate.tools).toEqual({})
      expect(run.gate.approvalEntries.size).toBe(0)
      expect(await run.attach({ isApproved: true })).toEqual({
        container: null,
        attachedCount: 0,
        failed: false,
      })
    })

    it('is inactive with no candidate skill', async () => {
      await seedSkill('data-report')

      const run = await prepare({ candidateSkillIds: [] })

      expect(run.gate.isActive).toBe(false)
    })
  })

  describe('which skills count', () => {
    it.each([
      ['has Allow scripts off', { allowScripts: false }],
      ['is switched off', { enabled: false }],
      ['is broken', { status: 'broken' as const }],
      ['has a restricted license', { licenseClass: 'restricted' as const }],
      ['ships no script', {
        files: { 'SKILL.md': SKILL_MD, 'references/a.md': 'text' },
      }],
    ])('leaves out a skill that %s', async (_label, overrides) => {
      const skillId = await seedSkill('data-report', overrides)
      const run = await prepare({ candidateSkillIds: [skillId] })

      expect(run.gate.isActive).toBe(false)
    })

    it('leaves out a skill that is not a candidate for the chat', async () => {
      await seedSkill('data-report')

      const other = await seedSkill('other-skill')
      const run = await prepare({ candidateSkillIds: [other] })

      expect(run.eligibleSkills.map(skill => skill.name))
        .toEqual(['other-skill'])
    })

    it('caps the request at eight skills, sorted by name', async () => {
      const ids: string[] = []

      for (let index = 9; index >= 0; index -= 1) {
        ids.push(await seedSkill(`skill-${index}`))
      }

      const run = await prepare({ candidateSkillIds: ids })

      expect(run.eligibleSkills).toHaveLength(8)
      expect(run.eligibleSkills.map(skill => skill.name)[0]).toBe('skill-0')
      expect(run.eligibleSkills.map(skill => skill.name)[7]).toBe('skill-7')
    })
  })

  describe('before the user allowed it', () => {
    it('registers the gate tool and a consent entry for the exact set', async () => {
      const skillId = await seedSkill('data-report')
      const run = await prepare({ candidateSkillIds: [skillId] })
      const entry = run.gate.approvalEntries.get(SKILL_SCRIPTS_GATE_TOOL_NAME)

      expect(run.gate.isActive).toBe(true)
      expect(run.gate.isGrantMatched).toBe(false)
      expect(Object.keys(run.gate.tools))
        .toEqual([SKILL_SCRIPTS_GATE_TOOL_NAME])
      expect(entry?.descriptor).toMatchObject({
        family: 'native',
        access: 'write',
        consentGate: true,
        definitionHash: await hashSkillScriptsSet([
          { id: skillId, currentVersion: 1 },
        ]),
      })
      expect(entry?.summary).toBe(
        'Run scripts from data-report in Anthropic\'s container on your key?',
      )
    })

    it('attaches nothing and uploads nothing until the answer is approved', async () => {
      const skillId = await seedSkill('data-report')
      const uploader = vi.fn()
      const run = await prepare({ candidateSkillIds: [skillId], uploader })

      expect(await run.attach({ isApproved: false })).toEqual({
        container: null,
        attachedCount: 0,
        failed: false,
      })
      expect(uploader).not.toHaveBeenCalled()
    })

    it('uploads and returns a pinned custom reference once approved', async () => {
      const skillId = await seedSkill('data-report')
      const uploader = vi.fn(async () => {
        return { providerSkillId: 'skill_77', latestVersion: '1759178010' }
      })
      const run = await prepare({ candidateSkillIds: [skillId], uploader })
      const attachment = await run.attach({ isApproved: true })

      expect(uploader).toHaveBeenCalledTimes(1)
      expect(attachment).toEqual({
        container: {
          skills: [{
            type: 'custom',
            providerReference: { anthropic: 'skill_77' },
            version: '1759178010',
          }],
        },
        attachedCount: 1,
        failed: false,
      })
      expect(await run.attach({ isApproved: true })).toBe(attachment)
      expect(uploader).toHaveBeenCalledTimes(1)
    })

    it('tells the model the upload failed through the tool result', async () => {
      const skillId = await seedSkill('data-report')
      const uploader = vi.fn(async () => {
        throw new Error('boom')
      })
      const run = await prepare({ candidateSkillIds: [skillId], uploader })
      const attachment = await run.attach({ isApproved: true })
      const gateTool = run.gate.tools[SKILL_SCRIPTS_GATE_TOOL_NAME] as {
        execute: () => Promise<string>
      }

      expect(attachment).toEqual({
        container: null,
        attachedCount: 0,
        failed: true,
      })
      expect(await gateTool.execute()).toBe(SKILL_SCRIPTS_UPLOAD_FAILED_TEXT)
    })

    it('answers allowed from the tool once the skills are attached', async () => {
      const skillId = await seedSkill('data-report')
      const run = await prepare({ candidateSkillIds: [skillId] })
      const gateTool = run.gate.tools[SKILL_SCRIPTS_GATE_TOOL_NAME] as {
        execute: () => Promise<string>
      }

      await run.attach({ isApproved: true })

      expect(await gateTool.execute()).toBe(SKILL_SCRIPTS_ALLOWED_TEXT)
    })
  })

  describe('with a chat grant', () => {
    it('attaches from the start and registers no gate tool', async () => {
      const skillId = await seedSkill('data-report')

      await addBesidkaChatGrant(testDb.db, userId, chatPublicId, {
        toolName: SKILL_SCRIPTS_GRANT_KEY,
        definitionHash: await hashSkillScriptsSet([
          { id: skillId, currentVersion: 1 },
        ]),
      })

      const run = await prepare({ candidateSkillIds: [skillId] })

      expect(run.gate.isGrantMatched).toBe(true)
      expect(run.gate.tools).toEqual({})
      expect(run.gate.approvalEntries.size).toBe(0)
      expect((await run.attach({ isApproved: false })).attachedCount).toBe(1)
    })

    it('asks again when another skill joins the set', async () => {
      const skillId = await seedSkill('data-report')

      await addBesidkaChatGrant(testDb.db, userId, chatPublicId, {
        toolName: SKILL_SCRIPTS_GRANT_KEY,
        definitionHash: await hashSkillScriptsSet([
          { id: skillId, currentVersion: 1 },
        ]),
      })

      const second = await seedSkill('other-skill')
      const run = await prepare({ candidateSkillIds: [skillId, second] })

      expect(run.gate.isGrantMatched).toBe(false)
      expect(Object.keys(run.gate.tools))
        .toEqual([SKILL_SCRIPTS_GATE_TOOL_NAME])
    })

    it('does not use a grant given in another chat', async () => {
      const skillId = await seedSkill('data-report')
      const otherChat = await seedChat(testDb.db, userId)

      await addBesidkaChatGrant(testDb.db, userId, otherChat.id, {
        toolName: SKILL_SCRIPTS_GRANT_KEY,
        definitionHash: await hashSkillScriptsSet([
          { id: skillId, currentVersion: 1 },
        ]),
      })

      const run = await prepare({ candidateSkillIds: [skillId] })

      expect(run.gate.isGrantMatched).toBe(false)
    })

    it('ignores a grant stored for a different tool name', async () => {
      const skillId = await seedSkill('data-report')

      await addBesidkaChatGrant(testDb.db, userId, chatPublicId, {
        toolName: 'besidka__list_chats',
        definitionHash: await hashSkillScriptsSet([
          { id: skillId, currentVersion: 1 },
        ]),
      })

      const run = await prepare({ candidateSkillIds: [skillId] })

      expect(run.gate.isGrantMatched).toBe(false)
    })
  })
})

describe('buildSkillScriptsInstruction', () => {
  it('asks the model to call the gate before running a script', () => {
    const text = buildSkillScriptsInstruction({
      skillNames: ['data-report'],
      isAttached: false,
      hasFailed: false,
    })

    expect(text).toContain(SKILL_SCRIPTS_GATE_TOOL_NAME)
    expect(text).toContain('data-report')
  })

  it('says the scripts are there once attached', () => {
    const text = buildSkillScriptsInstruction({
      skillNames: ['data-report'],
      isAttached: true,
      hasFailed: false,
    })

    expect(text).not.toContain(SKILL_SCRIPTS_GATE_TOOL_NAME)
    expect(text).toContain('available in the code sandbox')
  })

  it('tells the model not to run them when the upload failed', () => {
    const text = buildSkillScriptsInstruction({
      skillNames: ['data-report'],
      isAttached: false,
      hasFailed: true,
    })

    expect(text).toContain('Do not try to run them')
  })
})
