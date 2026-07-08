import type { UIMessageChunk } from 'ai'
import type { H3Event } from 'h3'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type {
  ResearchBriefData,
  ResearchDepth,
  ResearchStepData,
  ResearchStepPhase,
} from '#shared/types/research.d'
import {
  chatTestErrorIds,
  chatTestErrors,
  toChatTestErrorPayload,
} from '#shared/utils/chat-test-errors'
import { getRequestHeader } from 'h3'
import { getReasoningStepsCount } from '~~/server/utils/chats/test/steps-count'
import { getResearchStepsCount } from '~~/server/utils/chats/test/research-steps-count'

type Scenario = 'short' | 'long' | 'reasoning' | 'deep-research'

const INITIAL_DELAY: number = 800
const TEXT_CHUNK_DELAY: number = 50
const REASONING_CHUNK_DELAY: number = 100
const REASONING_STEP_DELAY: number = 300

const SHORT_TEXT: string
  = 'This is a short response from the AI. '
    + 'It contains just a couple of sentences '
    + 'to test basic rendering and scroll behavior.'

const LONG_TEXT: string[] = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '
  + 'Sed do eiusmod tempor incididunt ut labore et dolore '
  + 'magna aliqua. Ut enim ad minim veniam, quis nostrud '
  + 'exercitation ullamco laboris nisi ut aliquip ex ea '
  + 'commodo consequat.',

  'Duis aute irure dolor in reprehenderit in voluptate '
  + 'velit esse cillum dolore eu fugiat nulla pariatur. '
  + 'Excepteur sint occaecat cupidatat non proident, sunt '
  + 'in culpa qui officia deserunt mollit anim id est '
  + 'laborum. Sed ut perspiciatis unde omnis iste natus.',

  'Nemo enim ipsam voluptatem quia voluptas sit aspernatur '
  + 'aut odit aut fugit, sed quia consequuntur magni dolores '
  + 'eos qui ratione voluptatem sequi nesciunt. Neque porro '
  + 'quisquam est, qui dolorem ipsum quia dolor sit amet.',

  'At vero eos et accusamus et iusto odio dignissimos '
  + 'ducimus qui blanditiis praesentium voluptatum deleniti '
  + 'atque corrupti quos dolores et quas molestias excepturi '
  + 'sint occaecati cupiditate non provident.',

  'Similique sunt in culpa qui officia deserunt mollitia '
  + 'animi, id est laborum et dolorum fuga. Et harum quidem '
  + 'rerum facilis est et expedita distinctio. Nam libero '
  + 'tempore, cum soluta nobis est eligendi optio cumque '
  + 'nihil impedit quo minus id quod maxime placeat.',
]

const RESEARCH_MESSAGE_ID: string = 'test-message-deep-research'

const RESEARCH_TOPIC: string
  = 'the impact of remote work on team productivity'

const RESEARCH_SOURCES: Array<{ url: string, title: string }> = [
  {
    url: 'https://example.com/research/remote-work-study',
    title: 'Remote Work Productivity Study',
  },
  {
    url: 'https://example.com/research/team-collaboration',
    title: 'Team Collaboration Trends Report',
  },
  {
    url: 'https://example.com/research/hybrid-office',
    title: 'Hybrid Office Survey Results',
  },
  {
    url: 'https://example.com/research/manager-perspectives',
    title: 'Manager Perspectives On Distributed Teams',
  },
  {
    url: 'https://example.com/research/employee-wellbeing',
    title: 'Employee Wellbeing And Output Metrics',
  },
  {
    url: 'https://example.com/research/longitudinal-analysis',
    title: 'Longitudinal Analysis Of Output Metrics',
  },
]

const RESEARCH_REPORT_TEXT: string = [
  '## Deep research report',
  '',
  '### Key findings',
  '- Remote work shows mixed effects on productivity depending on role.',
  '- Structured communication rituals reduce coordination overhead.',
  '- Employee wellbeing correlates positively with sustained output.',
  '',
  '### Sources',
  'Findings are cross-checked against the search results collected above.',
].join('\n')

function splitIntoChunks(text: string): string[] {
  const words = text.split(' ')
  const chunks: string[] = []

  for (
    let index = 0;
    index < words.length;
    index += 3
  ) {
    const chunk = words.slice(index, index + 3).join(' ')

    chunks.push(chunk + ' ')
  }

  return chunks
}

function buildTextChunks(
  text: string,
  partId: string,
): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [
    { type: 'text-start', id: partId },
  ]
  const deltas = splitIntoChunks(text)

  for (const delta of deltas) {
    chunks.push({ type: 'text-delta', id: partId, delta })
  }

  chunks.push({ type: 'text-end', id: partId })

  return chunks
}

function buildReasoningChunks(
  text: string,
  partId: string,
): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [
    { type: 'reasoning-start', id: partId },
  ]
  const deltas = splitIntoChunks(text)

  for (const delta of deltas) {
    chunks.push({
      type: 'reasoning-delta',
      id: partId,
      delta,
    })
  }

  chunks.push({ type: 'reasoning-end', id: partId })

  return chunks
}

function buildResearchStepChunk(
  phase: ResearchStepPhase,
  data: ResearchStepData,
): UIMessageChunk {
  return {
    type: 'data-research-step',
    id: `research-step-${phase}`,
    data,
  }
}

function getResearchPhaseRepeatsCount(depth: ResearchDepth): number {
  return Math.floor((getResearchStepsCount(depth) - 3) / 2)
}

function buildResearchStepChunks(depth: ResearchDepth): UIMessageChunk[] {
  const phaseRepeatsCount = getResearchPhaseRepeatsCount(depth)
  const sourcesCount = Math.min(
    RESEARCH_SOURCES.length,
    phaseRepeatsCount * 2,
  )
  const chunks: UIMessageChunk[] = [
    buildResearchStepChunk('planning', {
      phase: 'planning',
      label: 'Planned the research approach',
      status: 'done',
    }),
  ]

  for (
    let searchIndex = 0;
    searchIndex < phaseRepeatsCount;
    searchIndex++
  ) {
    chunks.push(buildResearchStepChunk('searching', {
      phase: 'searching',
      label: 'Searching the web',
      status: 'active',
      count: searchIndex + 1,
      detail: `Query ${searchIndex + 1}: ${RESEARCH_TOPIC}`,
    }))
  }

  for (
    let sourceIndex = 0;
    sourceIndex < sourcesCount;
    sourceIndex++
  ) {
    const source = RESEARCH_SOURCES[sourceIndex]!

    chunks.push({
      type: 'source-url',
      sourceId: `test-research-source-${sourceIndex + 1}`,
      url: source.url,
      title: source.title,
    })
  }

  for (
    let readIndex = 0;
    readIndex < phaseRepeatsCount;
    readIndex++
  ) {
    chunks.push(buildResearchStepChunk('reading', {
      phase: 'reading',
      label: 'Reading sources',
      status: 'active',
      count: readIndex + 1,
    }))
  }

  chunks.push(buildResearchStepChunk('analyzing', {
    phase: 'analyzing',
    label: 'Analyzing the findings',
    status: 'active',
  }))

  chunks.push(buildResearchStepChunk('synthesizing', {
    phase: 'synthesizing',
    label: 'Writing the report',
    status: 'done',
  }))

  return chunks
}

function buildResearchBriefChunk(depth: ResearchDepth): UIMessageChunk {
  const data: ResearchBriefData = {
    topic: RESEARCH_TOPIC,
    depth,
    answers: [],
  }

  return {
    type: 'data-research-brief',
    data,
  }
}

function getChunksForScenario(
  scenario: Scenario,
  effort: ReasoningLevel,
  depth: ResearchDepth,
): UIMessageChunk[] {
  const effectiveScenario = scenario === 'reasoning' && effort === 'off'
    ? 'short'
    : scenario

  switch (effectiveScenario) {
    case 'short':
      return buildTextChunks(SHORT_TEXT, 'test-text-0')
    case 'long': {
      const chunks: UIMessageChunk[] = []
      const fullText = LONG_TEXT.join('\n\n')

      chunks.push(...buildTextChunks(fullText, 'test-text-0'))

      return chunks
    }
    case 'reasoning': {
      const chunks: UIMessageChunk[] = []
      const stepsCount = getReasoningStepsCount(effort)

      for (
        let stepIndex = 0;
        stepIndex < stepsCount;
        stepIndex++
      ) {
        const stepText
          = `**Step ${stepIndex + 1}**\n\n`
            + 'This is the reasoning for step '
            + `${stepIndex + 1}. It provides insights `
            + 'and explanations related to the '
            + 'user\'s message, helping to break '
            + 'down complex ideas into more '
            + 'digestible parts.'

        chunks.push(
          ...buildReasoningChunks(
            stepText,
            `test-reasoning-${stepIndex}`,
          ),
        )
      }
      chunks.push(
        ...buildTextChunks(
          LONG_TEXT.join('\n\n'),
          'test-text-0',
        ),
      )

      return chunks
    }
    case 'deep-research': {
      const chunks: UIMessageChunk[] = [
        { type: 'start', messageId: RESEARCH_MESSAGE_ID },
      ]

      chunks.push(...buildResearchStepChunks(depth))
      chunks.push(buildResearchBriefChunk(depth))
      chunks.push(...buildTextChunks(RESEARCH_REPORT_TEXT, 'test-text-0'))

      return chunks
    }
    default:
      return buildTextChunks(SHORT_TEXT, 'test-text-0')
  }
}

function getErrorChunks(errorText: string): UIMessageChunk[] {
  return [
    {
      type: 'source-url',
      sourceId: 'test-source-1',
      url: 'https://example.com/test-source',
      title: 'Test source',
    },
    ...buildTextChunks(
      'This is partial assistant output before the simulated failure.',
      'test-text-error',
    ),
    {
      type: 'error',
      errorText,
    },
  ]
}

export default defineEventHandler(async (event) => {
  const isCiEnvironment: boolean = process.env.CI === 'true'
  const isTestChatEndpointEnabled: boolean = import.meta.dev || isCiEnvironment

  if (!isTestChatEndpointEnabled) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not found',
    })
  }

  const query = await getValidatedQuery(event, z.object({
    scenario: z
      .enum(['short', 'long', 'reasoning', 'deep-research'])
      .default('short'),
    messages: z.string().regex(/^\d+$/).default('1').transform(Number),
    effort: z.enum(['off', 'low', 'medium', 'high']).default('medium'),
    depth: z.enum(['quick', 'standard', 'thorough']).default('standard'),
    error: z.enum(chatTestErrorIds).optional(),
  }).safeParse)

  if (query.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request query',
      data: query.error,
    })
  }

  const requestId = getRequestId(event)
  const errorId = query.data.error

  if (errorId && chatTestErrors[errorId].phase === 'prestream') {
    return new Response(JSON.stringify(toChatTestErrorPayload(
      errorId,
      requestId,
    )), {
      status: chatTestErrors[errorId].status,
      headers: {
        'content-type': 'application/json',
      },
    })
  }

  const chunks = errorId
    ? getErrorChunks(JSON.stringify(toChatTestErrorPayload(
      errorId,
      requestId,
    )))
    : getChunksForScenario(
      query.data.scenario,
      query.data.effort,
      query.data.depth,
    )

  const stream = createUIMessageStream({
    execute({ writer }) {
      const readable = new ReadableStream<UIMessageChunk>({
        async start(controller) {
          await delay(INITIAL_DELAY)
          let previousType: string = ''

          for (const chunk of chunks) {
            if (
              previousType === 'reasoning-end'
              && (
                chunk.type === 'text-start'
                || chunk.type === 'reasoning-start'
              )
            ) {
              await delay(REASONING_STEP_DELAY)
            }

            const chunkDelay
              = chunk.type.startsWith('reasoning')
                ? REASONING_CHUNK_DELAY
                : TEXT_CHUNK_DELAY

            await delay(chunkDelay)
            controller.enqueue(chunk)
            previousType = chunk.type
          }

          controller.close()
        },
      })

      writer.merge(readable)
    },
  })

  return createUIMessageStreamResponse({ stream })
})

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getRequestId(event: H3Event): string {
  try {
    return getRequestHeader(event as any, 'cf-ray')
      || getRequestHeader(event as any, 'x-request-id')
      || 'test-request-id'
  } catch (exception) {
    void exception

    return 'test-request-id'
  }
}
