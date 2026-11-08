import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ALLOWED_IMPORTS } from '../../../../../workers/artifacts-runtime/src/vendor'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import { createMemoryBlobStore } from '../../../../setup/helpers/artifacts-store'
import type { MemoryBlobStore } from '../../../../setup/helpers/artifacts-store'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const {
  ARTIFACT_REACT_IMPORTS,
  ARTIFACT_WRITES_PER_TURN,
  applyArtifactEdits,
  buildArtifactCodeBlocksDescription,
  buildArtifactInstructions,
  createArtifactTools,
} = await import('~~/server/utils/ai/artifact-tools')
const { createArtifact, readArtifactVersion } = await import(
  '~~/server/utils/artifacts/store'
)
const { toolRequiresFollowUpTurn } = await import(
  '~~/server/utils/ai/tool-loop'
)

const ALL_KINDS = ['html', 'react', 'svg', 'mermaid', 'markdown'] as const
const QUIZ = [
  '<h1>Quiz</h1>',
  '<p>Question 1: What do plants need?</p>',
  '<p>Question 2: Where does it happen?</p>',
  '<p>Question 3: What is produced?</p>',
].join('\n')

type ToolExecute = (input: unknown, options: unknown) => Promise<unknown>

describe('artifact tools', () => {
  let testDb: MemoryExtractionTestDb
  let storage: MemoryBlobStore
  let userId: number
  let otherUserId: number
  let chatId: string
  const logger = { set: vi.fn() }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    storage = createMemoryBlobStore()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
    chatId = (await seedChat(testDb.db, userId)).id
    logger.set.mockClear()
  })

  afterEach(() => {
    testDb.close()
  })

  function buildTools(overrides: {
    allowedKinds?: readonly typeof ALL_KINDS[number][]
    chatArtifactIds?: string[]
  } = {}) {
    const tools = createArtifactTools({
      db: testDb.db,
      storage,
      userId,
      chatId,
      messageId: 'assistant-public-1',
      allowedKinds: overrides.allowedKinds ?? ALL_KINDS,
      chatArtifactIds: overrides.chatArtifactIds ?? [],
      modelId: 'claude-opus-5',
      logger,
    })

    return {
      tools,
      create: (input: unknown) => {
        return (tools.create_artifact!.execute as ToolExecute)(input, {
          toolCallId: 'call-create',
          messages: [],
        })
      },
      update: (input: unknown) => {
        return (tools.update_artifact!.execute as ToolExecute)(input, {
          toolCallId: 'call-update',
          messages: [],
        })
      },
    }
  }

  function inputSchemaOf(tools: ReturnType<typeof buildTools>['tools'], name: string) {
    return tools[name]!.inputSchema as unknown as z.ZodType
  }

  it('marks both tools for a follow-up turn', () => {
    const { tools } = buildTools()

    expect(Object.keys(tools)).toEqual(['create_artifact', 'update_artifact'])
    expect(toolRequiresFollowUpTurn(tools.create_artifact)).toBe(true)
    expect(toolRequiresFollowUpTurn(tools.update_artifact)).toBe(true)
  })

  it('drops react from the kind enum when it is not allowed', () => {
    const { tools } = buildTools({
      allowedKinds: ['html', 'svg', 'mermaid', 'markdown'],
    })
    const schema = inputSchemaOf(tools, 'create_artifact')

    expect(schema.safeParse({
      kind: 'react',
      title: 'App',
      content: 'export default () => null',
    }).success).toBe(false)
    expect(schema.safeParse({
      kind: 'html',
      title: 'App',
      content: '<p>x</p>',
    }).success).toBe(true)
    expect(String(tools.create_artifact!.description)).not.toContain('react:')
  })

  it('describes the chat-style code and diagram elements briefly', () => {
    const description = String(buildTools().tools.create_artifact!.description)

    expect(description).toContain('<besidka-code lang="ts">')
    expect(description).toContain('<besidka-mermaid>')
    expect(description).toContain('data-besidka-raw')
    expect(description).toContain('```mermaid')
    expect(buildArtifactCodeBlocksDescription(ALL_KINDS).length)
      .toBeLessThan(450)
    expect(buildArtifactCodeBlocksDescription(['svg', 'mermaid'])).toBe('')
    expect(String(buildTools({ allowedKinds: ['svg'] })
      .tools.create_artifact!.description)).not.toContain('besidka-code')
  })

  it('validates the title length and a non-empty content', () => {
    const schema = inputSchemaOf(buildTools().tools, 'create_artifact')

    expect(schema.safeParse({
      kind: 'html',
      title: 'x'.repeat(121),
      content: 'a',
    }).success).toBe(false)
    expect(schema.safeParse({
      kind: 'html',
      title: 'Quiz',
      content: '',
    }).success).toBe(false)
  })

  it('creates an artifact with the chat and message as origin', async () => {
    const { create } = buildTools()
    const result = await create({ kind: 'html', title: 'Quiz', content: QUIZ })

    expect(result).toEqual({
      artifactId: expect.stringMatching(/^pub-\d+$/),
      version: 1,
      kind: 'html',
      title: 'Quiz',
    })

    const row = testDb.sqlite.prepare(
      'select origin_chat_id, origin_message_id, created_via from artifacts',
    ).get()

    expect(row).toEqual({
      origin_chat_id: Number(chatId.slice(4)),
      origin_message_id: 'assistant-public-1',
      created_via: 'chat',
    })
    expect(testDb.sqlite.prepare(
      'select created_by, model_id from artifact_versions',
    ).get()).toEqual({ created_by: 'model', model_id: 'claude-opus-5' })
  })

  it('applies unique edits in order and writes version 2', async () => {
    const { create, update } = buildTools()
    const created = await create({
      kind: 'html',
      title: 'Quiz',
      content: QUIZ,
    }) as { artifactId: string }
    const result = await update({
      artifactId: created.artifactId,
      edits: [
        {
          old_string: 'Question 3: What is produced?',
          new_string: 'Question 3: Which gas is released?',
        },
        { old_string: '<h1>Quiz</h1>', new_string: '<h1>Photosynthesis</h1>' },
      ],
    })

    expect(result).toMatchObject({ version: 2, title: 'Quiz' })

    const latest = await readArtifactVersion({
      db: testDb.db,
      storage,
      userId,
      artifactId: created.artifactId,
    })

    expect(latest.content).toContain('Which gas is released?')
    expect(latest.content).toContain('<h1>Photosynthesis</h1>')
  })

  it('rejects an ambiguous or missing old_string and writes nothing', async () => {
    const { create, update } = buildTools()
    const created = await create({
      kind: 'html',
      title: 'Quiz',
      content: QUIZ,
    }) as { artifactId: string }

    await expect(update({
      artifactId: created.artifactId,
      edits: [
        { old_string: '<h1>Quiz</h1>', new_string: '<h1>Q</h1>' },
        { old_string: 'Question', new_string: 'Q' },
      ],
    })).rejects.toMatchObject({
      code: 'artifact-edit-mismatch',
      message: expect.stringContaining('Edit 2 failed'),
    })
    await expect(update({
      artifactId: created.artifactId,
      edits: [{ old_string: 'nowhere', new_string: 'x' }],
    })).rejects.toMatchObject({
      code: 'artifact-edit-mismatch',
      message: expect.stringContaining('does not occur'),
    })
    expect(testDb.sqlite.prepare(
      'select count(*) as count from artifact_versions',
    ).get()).toEqual({ count: 1 })
    expect(storage.objects.size).toBe(1)
  })

  it('replaces the whole content and refuses edits plus content together', async () => {
    const { create, update } = buildTools()
    const created = await create({
      kind: 'markdown',
      title: 'Notes',
      content: '# One',
    }) as { artifactId: string }

    await expect(update({
      artifactId: created.artifactId,
      content: '# Two',
      edits: [{ old_string: 'One', new_string: 'Two' }],
    })).rejects.toMatchObject({ code: 'artifact-invalid-input' })
    await expect(update({ artifactId: created.artifactId }))
      .rejects.toMatchObject({ code: 'artifact-invalid-input' })
    await expect(update({
      artifactId: created.artifactId,
      content: '# Two',
      title: 'Renamed',
    })).resolves.toMatchObject({ version: 2, title: 'Renamed' })
  })

  it('updates only artifacts created in this chat that the user owns', async () => {
    const owned = await createArtifact({
      db: testDb.db,
      storage,
      userId,
      kind: 'html',
      title: 'Earlier',
      content: '<p>a</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })
    const foreign = await createArtifact({
      db: testDb.db,
      storage,
      userId: otherUserId,
      kind: 'html',
      title: 'Foreign',
      content: '<p>b</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })

    await expect(buildTools().update({
      artifactId: owned.artifactId,
      content: '<p>c</p>',
    })).rejects.toMatchObject({
      code: 'artifact-unknown',
      message: expect.stringContaining('Unknown artifact for this chat'),
    })

    const referenced = buildTools({
      chatArtifactIds: [owned.artifactId, foreign.artifactId],
    })

    await expect(referenced.update({
      artifactId: owned.artifactId,
      content: '<p>c</p>',
    })).resolves.toMatchObject({ version: 2 })
    await expect(referenced.update({
      artifactId: foreign.artifactId,
      content: '<p>d</p>',
    })).rejects.toMatchObject({ code: 'artifact-unknown' })
  })

  it('never loses an edit when two edits of one artifact run in parallel', async () => {
    const { create, update } = buildTools()
    const created = await create({
      kind: 'html',
      title: 'Quiz',
      content: QUIZ,
    }) as { artifactId: string }
    const results = await Promise.allSettled([
      update({
        artifactId: created.artifactId,
        edits: [{ old_string: 'Question 1', new_string: 'First' }],
      }),
      update({
        artifactId: created.artifactId,
        edits: [{ old_string: 'Question 2', new_string: 'Second' }],
      }),
    ])
    const latest = await readArtifactVersion({
      db: testDb.db,
      storage,
      userId,
      artifactId: created.artifactId,
    })
    const rejected = results.filter((result) => {
      return result.status === 'rejected'
    }) as PromiseRejectedResult[]

    if (rejected.length === 0) {
      expect(latest.content).toContain('First')
      expect(latest.content).toContain('Second')
    } else {
      expect(rejected).toHaveLength(1)
      expect(rejected[0]!.reason).toMatchObject({
        code: 'artifact-version-conflict',
        message: expect.stringContaining('Read the artifact again'),
      })
      expect(latest.version).toBe(2)
    }
  })

  it('caps the writes per turn', async () => {
    const { create, update } = buildTools()
    const created = await create({
      kind: 'svg',
      title: 'Logo',
      content: '<svg/>',
    }) as { artifactId: string }

    for (let index = 1; index < ARTIFACT_WRITES_PER_TURN; index++) {
      await update({ artifactId: created.artifactId, content: `<svg>${index}</svg>` })
    }

    await expect(create({
      kind: 'svg',
      title: 'Another',
      content: '<svg/>',
    })).rejects.toMatchObject({ code: 'artifact-turn-limit' })
  })

  it('maps the store limits to readable tool errors', async () => {
    const { create } = buildTools()

    await expect(create({
      kind: 'html',
      title: 'Huge',
      content: 'a'.repeat(600 * 1024),
    })).rejects.toMatchObject({
      code: 'artifact-too-large',
      message: expect.stringContaining('This artifact is too large'),
    })

    testDb.sqlite.prepare(`
      insert into artifacts (user_id, kind, title, current_version,
        total_bytes, created_via, created_at, updated_at)
      values (?, 'html', 'Big', 1, ?, 'chat', 1, 1)
    `).run(userId, 25 * 1024 * 1024)

    await expect(create({
      kind: 'html',
      title: 'Over quota',
      content: 'a',
    })).rejects.toMatchObject({
      code: 'artifact-quota',
      message: expect.stringContaining('25.00 MB'),
    })
  })

  it('maps the version cap to a tool error', async () => {
    const created = await createArtifact({
      db: testDb.db,
      storage,
      userId,
      kind: 'html',
      title: 'Capped',
      content: '<p>a</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })

    testDb.sqlite.prepare('update artifacts set current_version = 50').run()

    await expect(buildTools({
      chatArtifactIds: [created.artifactId],
    }).update({
      artifactId: created.artifactId,
      content: '<p>b</p>',
    })).rejects.toMatchObject({ code: 'artifact-version-cap' })
  })
})

describe('applyArtifactEdits', () => {
  it('counts overlapping matches as ambiguous', () => {
    expect(() => applyArtifactEdits('aaa', [{
      old_string: 'aa',
      new_string: 'b',
    }])).toThrow(/occurs more than once/)
  })

  it('keeps dollar signs in the replacement literally', () => {
    expect(applyArtifactEdits('price: X', [{
      old_string: 'X',
      new_string: '$& $1 $$',
    }])).toBe('price: $& $1 $$')
  })

  it('sees the content as left by the previous edit', () => {
    expect(applyArtifactEdits('one two', [
      { old_string: 'one', new_string: 'two' },
      { old_string: 'two two', new_string: 'done' },
    ])).toBe('done')
  })
})

describe('buildArtifactInstructions', () => {
  it('lists the runtime imports and the sandbox rules', () => {
    const text = buildArtifactInstructions(ALL_KINDS, {
      storage: false,
      modelBridge: false,
    })

    expect([...ARTIFACT_REACT_IMPORTS]).toEqual([...ALLOWED_IMPORTS])
    expect(text).toContain('recharts')
    expect(text).toContain('no navigation or redirects')
    expect(text).toContain('passwords')
    expect(text).toContain('cannot keep data between visits')
    expect(text).toContain('cannot call a model')
  })

  it('mentions storage and the model bridge only when they are on', () => {
    const text = buildArtifactInstructions(['html'], {
      storage: true,
      modelBridge: true,
    })

    expect(text).toContain('window.besidka.storage')
    expect(text).toContain('window.besidka.complete()')
    expect(text).not.toContain('React artifacts')
  })
})
