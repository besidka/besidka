import type { UIMessageChunk } from 'ai'

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai'

type Scenario = 'short' | 'long' | 'reasoning'
type ReasoningEffort = 'off' | 'low' | 'medium' | 'high'

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

function getChunksForScenario(
  scenario: Scenario,
  effort: ReasoningEffort,
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
    default:
      return buildTextChunks(SHORT_TEXT, 'test-text-0')
  }
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
      .enum(['short', 'long', 'reasoning'])
      .default('short'),
    messages: z.string().regex(/^\d+$/).default('1').transform(Number),
    effort: z.enum(['off', 'low', 'medium', 'high']).default('medium'),
  }).safeParse)

  if (query.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request query',
      data: query.error,
    })
  }

  const chunks = getChunksForScenario(
    query.data.scenario,
    query.data.effort,
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

function getReasoningStepsCount(
  effort: ReasoningEffort,
): number {
  if (effort === 'off') {
    return 0
  }

  if (effort === 'low') {
    return 2
  }

  if (effort === 'high') {
    return 6
  }

  return 4
}
