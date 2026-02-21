import type { UIMessageChunk } from 'ai'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  simulateReadableStream,
} from 'ai'

type Scenario = 'short' | 'long' | 'reasoning'

const INITIAL_DELAY: number = 800
const CHUNK_DELAY: number = 50

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

const REASONING_TEXT: string
  = 'Let me think about this step by step. '
    + 'First, I need to consider the context. '
    + 'Then I should analyze the key factors. '
    + 'Finally, I can formulate a response.'

const REASONING_RESPONSE: string
  = 'Based on my analysis, here is a thoughtful '
    + 'response that demonstrates reasoning capability. '
    + 'The key insight is that structured thinking '
    + 'leads to better outcomes.'

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
): UIMessageChunk[] {
  switch (scenario) {
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

      chunks.push(
        ...buildReasoningChunks(
          REASONING_TEXT,
          'test-reasoning-0',
        ),
      )
      chunks.push(
        ...buildTextChunks(
          REASONING_RESPONSE,
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
  }).safeParse)

  console.log('query', query)

  if (query.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request query',
      data: query.error,
    })
  }

  const chunks = getChunksForScenario(query.data.scenario)

  const stream = createUIMessageStream({
    execute({ writer }) {
      const simulated = simulateReadableStream({
        chunks,
        initialDelayInMs: INITIAL_DELAY,
        chunkDelayInMs: CHUNK_DELAY,
      })

      writer.merge(simulated)
    },
  })

  return createUIMessageStreamResponse({ stream })
})
