import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import { getPersistedEmptyAnswerFailureText } from '#shared/utils/chat-failure-text'
import {
  keyProviderIdForGateway,
  readOpenRouterCost,
  readVercelGatewayCost,
  readVercelGenerationId,
} from '../../../server/utils/gateways/index'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const MODEL_ID = 'gpt-5-mini'
const SKILL_BODY = 'SKILL BODY: write in short sentences. Args: $ARGUMENTS'

interface FakeSkill {
  id: string
  name: string
  description: string
  currentVersion: number
  sourceKind: string
  enabled: boolean
  modelInvocable: boolean
}

const mocks = vi.hoisted(() => ({
  mergedStreams: [] as ReadableStream[],
  aiLoggerSet: vi.fn(),
  activeFlags: new Set<string>(),
  skills: new Map<string, FakeSkill>(),
  skillsFlagActive: true,
  historyMessages: [] as Array<Record<string, unknown>>,
  lastInsertValues: null as ReturnType<typeof vi.fn> | null,
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    createUIMessageStream: ({ execute }: { execute: Function }) => {
      const writer = {
        write: vi.fn(),
        merge: vi.fn((stream: ReadableStream) => {
          mocks.mergedStreams.push(stream)
        }),
      }
      const ready = execute({ writer })

      return { writer, ready }
    },
    createUIMessageStreamResponse: ({ stream }: { stream: unknown }) => stream,
  }
})

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: vi.fn(),
    getContext: () => ({ requestId: 'test-request-id' }),
  }),
  createRequestLogger: () => ({
    set: mocks.aiLoggerSet,
    emit: vi.fn(() => null),
    getContext: () => ({}),
  }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  createError: (input: { message?: string }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/features/send-features', () => ({
  resolveSendFeatures: vi.fn(async () => ({
    isFeatureActive: (flag: string) => mocks.activeFlags.has(flag),
  })),
}))

vi.mock('~~/server/utils/files/assistant-files', () => ({
  getModelContextFileStorageKeys: vi.fn(() => []),
  getGeneratedImageFileIds: vi.fn(() => []),
  isKnownImageGenerationModel: vi.fn(() => false),
  buildModelContextMessages: vi.fn((messages: Array<{
    parts: Array<{ type: string }>
  }>) => ({
    messages: messages.filter((message) => {
      return message.parts.some((part) => {
        return part.type === 'text' || part.type === 'file'
      })
    }),
    omittedFiles: [],
  })),
  sanitizeMessagesForModelContext: vi.fn((messages: unknown) => messages),
  normalizeAssistantMessagePartsForPersistence: vi.fn(
    async (input: { parts: unknown }) => input.parts,
  ),
  isPersistedOversizedResponseFailureText: vi.fn(() => false),
  stripUndeliveredInlineDataParts: vi.fn((parts: unknown) => parts),
  persistGatewayGeneratedImageParts: vi.fn(
    async (input: { parts: unknown }) => ({
      parts: input.parts,
      fileIds: [],
    }),
  ),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/memory/tools/enabled', () => ({
  isChatSearchToolEnabled: () => false,
  isMemoryToolsEnabled: () => false,
}))

vi.mock('~~/server/utils/features/context', () => ({
  evaluateFeatureForEvent: vi.fn(async () => ({
    active: mocks.skillsFlagActive,
  })),
}))

vi.mock('~~/server/utils/skills/runtime/load', () => {
  const toRow = (skill: FakeSkill) => skill

  return {
    listCatalogSkills: vi.fn(async () => {
      return [...mocks.skills.values()].filter((skill) => {
        return skill.enabled && skill.modelInvocable
      }).map(toRow)
    }),
    findRunnableSkill: vi.fn(async (
      _db: unknown,
      _userId: number,
      skillId: string,
    ) => {
      const skill = mocks.skills.get(skillId)

      return skill?.enabled ? toRow(skill) : null
    }),
    findRunnableSkills: vi.fn(async (
      _db: unknown,
      _userId: number,
      skillIds: string[],
    ) => {
      return skillIds.flatMap((skillId) => {
        const skill = mocks.skills.get(skillId)

        return skill?.enabled && skill.modelInvocable ? [toRow(skill)] : []
      })
    }),
    loadSkillContent: vi.fn(async (input: { skill: FakeSkill }) => {
      return { ...input.skill, body: SKILL_BODY, files: [] }
    }),
    readSkillFileText: vi.fn(async () => null),
  }
})

function createUsage() {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 20, text: 20, reasoning: undefined },
  }
}

function toolCall(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
) {
  return [
    {
      type: 'tool-call' as const,
      toolCallId,
      toolName,
      input: JSON.stringify(input),
    },
    {
      type: 'finish' as const,
      finishReason: { unified: 'tool-calls' as const, raw: undefined },
      usage: createUsage(),
    },
  ]
}

function text(value: string) {
  return [
    { type: 'text-start' as const, id: 'text-1' },
    { type: 'text-delta' as const, id: 'text-1', delta: value },
    { type: 'text-end' as const, id: 'text-1' },
    {
      type: 'finish' as const,
      finishReason: { unified: 'stop' as const, raw: undefined },
      usage: createUsage(),
    },
  ]
}

function createScriptedModel(steps: Array<Array<Record<string, unknown>>>) {
  let callCount = 0
  const doStream = vi.fn(async () => {
    const chunks = steps[Math.min(callCount, steps.length - 1)] ?? []

    callCount += 1

    return { stream: simulateReadableStream({ chunks: chunks as any }) }
  })

  return { model: new MockLanguageModelV4({ doStream }), doStream }
}

function createDb() {
  const insertValues = vi.fn()

  mocks.lastInsertValues = insertValues
  const insertGet = vi.fn(async () => ({
    id: 'message-db-id',
    publicId: 'db-generated-public-id',
  }))
  const updateWhere = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))

  insertValues.mockImplementation(() => ({
    returning: () => ({ get: insertGet }),
    onConflictDoNothing: () => ({ returning: () => ({ get: insertGet }) }),
  }))

  return {
    db: {
      query: {
        userSettings: {
          findFirst: vi.fn(async () => ({
            memoryEnabled: false,
            chatSearchEnabled: false,
            memoryIncludeSensitive: false,
            aboutMe: null,
          })),
        },
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: null,
            project: null,
            messages: mocks.historyMessages,
          })),
        },
        keys: {
          findFirst: vi.fn(async () => ({ apiKey: 'encrypted-key' })),
        },
        messages: { findFirst: vi.fn(async () => undefined) },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
    },
    insertValues,
  }
}

function stubChatProvider(toolCallSupported: boolean) {
  vi.stubGlobal('useChatProvider', vi.fn(() => ({
    provider: { id: 'openai' },
    model: {
      id: MODEL_ID,
      name: 'GPT-5 mini',
      tools: ['web_search', 'image_generation'],
      toolCall: toolCallSupported,
      modalities: { input: ['text'], output: ['text'] },
    },
  })))
}

function seedSkill(skill: Partial<FakeSkill> & { id: string, name: string }) {
  mocks.skills.set(skill.id, {
    description: `About ${skill.name}`,
    currentVersion: 1,
    sourceKind: 'editor',
    enabled: true,
    modelInvocable: true,
    ...skill,
  })
}

function invocationPart(skillId: string, name: string) {
  return {
    type: 'data-skill-invocation',
    data: { skillId, name, version: 1 },
  }
}

async function readClientStream(): Promise<Array<Record<string, any>>> {
  const chunks: Array<Record<string, any>> = []
  const reader = mocks.mergedStreams[0]!.getReader()

  for (;;) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    chunks.push(value)
  }

  return chunks
}

async function runSend(input: {
  steps: Array<Array<Record<string, unknown>>>
  tools?: string[]
  parts?: Array<Record<string, unknown>>
  userMessageId?: string
}) {
  const { model, doStream } = createScriptedModel(input.steps)

  vi.stubGlobal('useOpenAI', vi.fn(async () => ({
    instance: model,
    tools: {},
    providerOptions: {},
  })))

  const module = await import('../../../server/api/v1/chats/[slug]/index.post')
  const created = createDb()

  vi.stubGlobal('useDb', () => created.db)

  const result = await module.default({
    params: { slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    body: {
      model: MODEL_ID,
      tools: input.tools ?? [],
      reasoning: 'off',
      messages: [{
        id: input.userMessageId ?? 'user-public-1',
        role: 'user',
        parts: input.parts ?? [{
          type: 'text',
          text: 'Make a quiz about photosynthesis.',
        }],
      }],
    },
  } as any)

  await result.ready

  const assistantInsert = created.insertValues.mock.calls.find(([value]) => {
    return value.role === 'assistant'
  })?.[0]

  return { doStream, assistantInsert, result }
}

function readToolNames(callOptions: any): string[] {
  return (callOptions?.tools ?? []).map((declared: { name: string }) => {
    return declared.name
  })
}

function readSystemPrompt(callOptions: any): string {
  const systemMessage = callOptions?.prompt?.find((message: any) => {
    return message.role === 'system'
  })

  return String(systemMessage?.content ?? '')
}

function readLastUserText(callOptions: any): string {
  const userMessage = (callOptions?.prompt ?? []).filter((message: any) => {
    return message.role === 'user'
  }).at(-1)

  return (userMessage?.content ?? []).map((part: any) => {
    return part.text ?? ''
  }).join('\n')
}

describe('skills on the chat send path', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.mergedStreams = []
    mocks.skills.clear()
    mocks.historyMessages = []
    mocks.skillsFlagActive = true
    mocks.activeFlags = new Set(['skills'])
    seedSkill({ id: 'skl1', name: 'writing-style', modelInvocable: true })
    seedSkill({ id: 'skl2', name: 'meeting-notes', modelInvocable: false })
    vi.stubGlobal('useFileStorage', () => ({}))

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRequestURL', () => {
      return new URL('http://localhost/api/v1/chats/test')
    })
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => parser(event.body))
    vi.stubGlobal(
      'useUserSession',
      vi.fn().mockResolvedValue({ user: { id: '1' } }),
    )
    vi.stubGlobal('validateMessageFilePolicy', vi.fn(async () => undefined))
    vi.stubGlobal('convertFilesForAI', vi.fn(async (messages: unknown) => ({
      messages,
      missingFiles: [],
    })))
    vi.stubGlobal('attachCloudflareMeta', vi.fn())
    vi.stubGlobal('shipWideEventToAxiom', vi.fn(async () => undefined))
    vi.stubGlobal('useKV', () => ({
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async () => 'decrypted-key'))
    vi.stubGlobal('getRequiredModelTools', vi.fn(() => []))
    vi.stubGlobal('sendPushNotificationToUser', vi.fn(async () => undefined))
    vi.stubGlobal('buildVapidSubject', vi.fn(() => 'mailto:test@example.com'))
    vi.stubGlobal('keyProviderIdForGateway', keyProviderIdForGateway)
    vi.stubGlobal('readOpenRouterCost', readOpenRouterCost)
    vi.stubGlobal('readVercelGatewayCost', readVercelGatewayCost)
    vi.stubGlobal('readVercelGenerationId', readVercelGenerationId)
    stubChatProvider(true)
  })

  it('lists only Auto skills in the system prompt and registers the two tools', async () => {
    const { doStream } = await runSend({ steps: [text('Hello.')] })
    const call = doStream.mock.calls[0]?.[0] as any

    expect(readToolNames(call)).toEqual(
      expect.arrayContaining(['activate_skill', 'read_skill_file']),
    )
    expect(readSystemPrompt(call)).toContain('<available_skills>')
    expect(readSystemPrompt(call)).toContain('- writing-style: About writing-style')
    expect(readSystemPrompt(call)).not.toContain('meeting-notes')
  })

  it('adds nothing when the skills flag is off, even for an attached skill', async () => {
    mocks.activeFlags = new Set()
    mocks.skillsFlagActive = false

    const { doStream } = await runSend({
      steps: [text('Hello.')],
      parts: [{ type: 'text', text: 'Hi' }],
    })
    const call = doStream.mock.calls[0]?.[0] as any

    expect(readToolNames(call)).not.toContain('activate_skill')
    expect(readSystemPrompt(call)).not.toContain('available_skills')
  })

  it('refuses an attached skill with the generic 400 when the flag is off', async () => {
    mocks.activeFlags = new Set()
    mocks.skillsFlagActive = false

    await expect(runSend({
      steps: [text('Hello.')],
      parts: [
        { type: 'text', text: 'Hi' },
        invocationPart('skl2', 'meeting-notes'),
      ],
    })).rejects.toMatchObject({
      status: 400,
      code: 'skill_invocation_unavailable',
    })
  })

  it('injects an Only when I ask skill into the latest user turn, never the system prompt, and keeps it one-shot', async () => {
    const { doStream, assistantInsert } = await runSend({
      steps: [text('Done.')],
      parts: [
        { type: 'text', text: 'the quarterly meeting' },
        invocationPart('skl2', 'meeting-notes'),
      ],
    })
    const call = doStream.mock.calls[0]?.[0] as any

    expect(readLastUserText(call)).toContain(
      'SKILL BODY: write in short sentences. Args: the quarterly meeting',
    )
    expect(readLastUserText(call)).toContain('invoked="user"')
    expect(readSystemPrompt(call)).not.toContain('SKILL BODY')
    expect((assistantInsert?.parts ?? []).some((part: any) => {
      return part.type === 'data-skill-activation'
    })).toBe(false)
  })

  it('persists the activation part of an attached Auto skill, so it stays active', async () => {
    const { doStream, assistantInsert } = await runSend({
      steps: [text('Done.')],
      parts: [
        { type: 'text', text: 'write it' },
        invocationPart('skl1', 'writing-style'),
      ],
    })
    const call = doStream.mock.calls[0]?.[0] as any
    const activations = (assistantInsert?.parts ?? []).filter((part: any) => {
      return part.type === 'data-skill-activation'
    })

    expect(readLastUserText(call)).toContain('SKILL BODY')
    expect(activations).toEqual([{
      type: 'data-skill-activation',
      data: expect.objectContaining({
        skillId: 'skl1',
        name: 'writing-style',
        version: 1,
      }),
    }])
  })

  it('re-injects an earlier activation into the system prompt on a later send', async () => {
    mocks.historyMessages = [
      {
        id: 'm-1',
        publicId: 'p-1',
        role: 'user',
        parts: [{ type: 'text', text: 'write it' }],
        tools: [],
        reasoning: 'off',
      },
      {
        id: 'm-2',
        publicId: 'p-2',
        role: 'assistant',
        parts: [
          {
            type: 'data-skill-activation',
            data: { skillId: 'skl1', name: 'writing-style', version: 1 },
          },
          { type: 'text', text: 'Done.' },
        ],
        tools: [],
        reasoning: 'off',
      },
    ]

    const { doStream } = await runSend({ steps: [text('More.')] })
    const call = doStream.mock.calls[0]?.[0] as any

    expect(readSystemPrompt(call)).toContain('<active_skills>')
    expect(readSystemPrompt(call)).toContain('SKILL BODY')
  })

  it('stores an activate_skill call without its text and adds the activation part', async () => {
    const { assistantInsert } = await runSend({
      steps: [
        toolCall('call-1', 'activate_skill', { name: 'writing-style' }),
        text('Used the skill.'),
      ],
    })
    const parts = assistantInsert?.parts ?? []
    const toolPart = parts.find((part: any) => {
      return part.type === 'tool-activate_skill'
    })

    expect(toolPart).toMatchObject({
      state: 'output-available',
      output: { status: 'activated', skillId: 'skl1', name: 'writing-style' },
    })
    expect(JSON.stringify(parts)).not.toContain('SKILL BODY')
    expect(parts).toContainEqual(expect.objectContaining({
      type: 'data-skill-activation',
      data: expect.objectContaining({ skillId: 'skl1' }),
    }))
  })

  it('stores no failure text for a skill-only tool round that ends without text', async () => {
    const { assistantInsert } = await runSend({
      steps: [
        toolCall('call-1', 'activate_skill', { name: 'writing-style' }),
        [{
          type: 'finish' as const,
          finishReason: { unified: 'stop' as const, raw: undefined },
          usage: createUsage(),
        }],
      ],
    })
    const texts = (assistantInsert?.parts ?? [])
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text)

    expect(texts).not.toContain(getPersistedEmptyAnswerFailureText())
    expect(assistantInsert).toBeUndefined()
  })

  it('does not re-inject a skill that was switched to Only when I ask after its activation', async () => {
    mocks.skills.get('skl1')!.modelInvocable = false
    mocks.historyMessages = [
      {
        id: 'm-1',
        publicId: 'p-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Earlier question' }],
        tools: [],
        reasoning: 'off',
      },
      {
        id: 'm-2',
        publicId: 'p-2',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Earlier answer.' },
          {
            type: 'data-skill-activation',
            data: { skillId: 'skl1', name: 'writing-style', version: 1 },
          },
        ],
        tools: [],
        reasoning: 'off',
      },
    ]

    const { doStream } = await runSend({ steps: [text('Hello.')] })
    const call = doStream.mock.calls[0]?.[0] as any

    expect(readSystemPrompt(call)).not.toContain('SKILL BODY')
    expect(readSystemPrompt(call)).toContain('no longer available')
  })

  it('stores nothing and answers 400 when the attached skill cannot be read', async () => {
    const { loadSkillContent } = await import(
      '~~/server/utils/skills/runtime/load'
    )

    vi.mocked(loadSkillContent).mockRejectedValueOnce(new Error('R2 miss'))

    const failure = runSend({
      steps: [text('Done.')],
      userMessageId: 'user-public-2',
      parts: [invocationPart('skl2', 'meeting-notes')],
    })

    await expect(failure).rejects.toMatchObject({
      status: 400,
      code: 'skill_invocation_unavailable',
    })
    expect(mocks.lastInsertValues).not.toBeNull()
    expect(mocks.lastInsertValues).not.toHaveBeenCalled()
  })

  it('carries a message that is only an attached skill to the model as a new user turn and a new reply', async () => {
    mocks.historyMessages = [
      {
        id: 'm-1',
        publicId: 'p-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Earlier question' }],
        tools: [],
        reasoning: 'off',
      },
      {
        id: 'm-2',
        publicId: 'p-2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Earlier answer.' }],
        tools: [],
        reasoning: 'off',
      },
    ]

    const { doStream } = await runSend({
      steps: [text('Done.')],
      userMessageId: 'user-public-2',
      parts: [invocationPart('skl2', 'meeting-notes')],
    })
    const call = doStream.mock.calls[0]?.[0] as any
    const roles = (call.prompt as any[])
      .filter(message => message.role !== 'system')
      .map(message => message.role)
    const chunks = await readClientStream()
    const start = chunks.find(chunk => chunk.type === 'start')

    const storedUserRow = mocks.lastInsertValues?.mock.calls.find(([value]) => {
      return value.role === 'user'
    })?.[0]

    expect(storedUserRow?.parts).toEqual([invocationPart('skl2', 'meeting-notes')])
    expect(JSON.stringify(storedUserRow)).not.toContain('SKILL BODY')
    expect(roles).toEqual(['user', 'assistant', 'user'])
    expect(readLastUserText(call)).toContain('SKILL BODY')
    expect(start?.messageId).not.toBe('p-2')
  })

  it('fails a stored skill-only message whose skill is gone with the generic 400', async () => {
    mocks.skills.get('skl2')!.enabled = false
    mocks.historyMessages = [{
      id: 'm-1',
      publicId: 'user-public-1',
      role: 'user',
      parts: [invocationPart('skl2', 'meeting-notes')],
      tools: [],
      reasoning: 'off',
    }]

    await expect(runSend({
      steps: [text('Done.')],
      parts: [invocationPart('skl2', 'meeting-notes')],
    })).rejects.toMatchObject({
      status: 400,
      code: 'skill_invocation_unavailable',
    })
  })

  it('drops a missing skill from a stored message that still has text', async () => {
    mocks.skills.get('skl2')!.enabled = false
    mocks.historyMessages = [{
      id: 'm-1',
      publicId: 'user-public-1',
      role: 'user',
      parts: [
        { type: 'text', text: 'Hello' },
        invocationPart('skl2', 'meeting-notes'),
      ],
      tools: [],
      reasoning: 'off',
    }]

    const { doStream } = await runSend({
      steps: [text('Hi.')],
      parts: [
        { type: 'text', text: 'Hello' },
        invocationPart('skl2', 'meeting-notes'),
      ],
    })
    const call = doStream.mock.calls[0]?.[0] as any

    expect(readLastUserText(call)).not.toContain('SKILL BODY')
  })
})
