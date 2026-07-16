import type { UIMessageChunk } from 'ai'
import type { H3Event } from 'h3'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { ChatTestScenario } from '#shared/utils/chat-test-errors'
import {
  chatTestErrorIds,
  chatTestErrors,
  chatTestScenarios,
  toChatTestErrorPayload,
} from '#shared/utils/chat-test-errors'
import { getRequestHeader } from 'h3'
import { getReasoningStepsCount } from '~~/server/utils/chats/test/steps-count'

type Scenario = ChatTestScenario

interface TimedChunk {
  chunk: UIMessageChunk
  delay?: number
}

const INITIAL_DELAY: number = 800
const TEXT_CHUNK_DELAY: number = 50
const REASONING_CHUNK_DELAY: number = 100
const REASONING_STEP_DELAY: number = 300

const IMAGE_TOOL_CALL_ID: string = 'test-image-call-0'
const IMAGE_TOOL_CALL_TO_INPUT_DELAY: number = 400
const IMAGE_INPUT_TO_GENERATING_DELAY: number = 200
const IMAGE_GENERATING_TO_SAVING_DELAY: number = 1500
const IMAGE_SAVING_TO_READY_DELAY: number = 800
const IMAGE_TEST_STORAGE_KEY: string = 'test-generated-image.webp'

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
): TimedChunk[] {
  const chunks: UIMessageChunk[] = [
    { type: 'text-start', id: partId },
  ]
  const deltas = splitIntoChunks(text)

  for (const delta of deltas) {
    chunks.push({ type: 'text-delta', id: partId, delta })
  }

  chunks.push({ type: 'text-end', id: partId })

  return chunks.map(chunk => ({ chunk }))
}

function buildReasoningChunks(
  text: string,
  partId: string,
): TimedChunk[] {
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

  return chunks.map(chunk => ({ chunk }))
}

function buildImageGenerationChunks(
  options: { withReasoningFirst: boolean },
): TimedChunk[] {
  const chunks: TimedChunk[] = []

  if (options.withReasoningFirst) {
    chunks.push(...buildReasoningChunks(
      'Deciding on a good scene and lighting for this request '
      + 'before generating the image.',
      'test-image-reasoning-0',
    ))
  }

  chunks.push(
    {
      chunk: {
        type: 'tool-input-start',
        toolCallId: IMAGE_TOOL_CALL_ID,
        toolName: 'generate_image',
      },
    },
    {
      chunk: {
        type: 'tool-input-available',
        toolCallId: IMAGE_TOOL_CALL_ID,
        toolName: 'generate_image',
        input: {
          prompt: 'A test image for the scroll-spacer scenario',
          aspectRatio: '2:3',
        },
      },
      delay: IMAGE_TOOL_CALL_TO_INPUT_DELAY,
    },
    {
      chunk: {
        type: 'tool-output-available',
        toolCallId: IMAGE_TOOL_CALL_ID,
        output: { status: 'generating' },
        preliminary: true,
      },
      delay: IMAGE_INPUT_TO_GENERATING_DELAY,
    },
    {
      chunk: {
        type: 'tool-output-available',
        toolCallId: IMAGE_TOOL_CALL_ID,
        output: { status: 'saving' },
        preliminary: true,
      },
      delay: IMAGE_GENERATING_TO_SAVING_DELAY,
    },
    {
      chunk: {
        type: 'tool-output-available',
        toolCallId: IMAGE_TOOL_CALL_ID,
        output: {
          status: 'ready',
          provider: 'google',
          model: 'gemini-3.1-flash-image',
          file: {
            id: 'test-image-file-0',
            storageKey: IMAGE_TEST_STORAGE_KEY,
            name: 'test-generated-image.webp',
            size: 204800,
            type: 'image/webp',
            source: 'assistant',
            url: `/files/${IMAGE_TEST_STORAGE_KEY}`,
            downloadUrl: `/files/${IMAGE_TEST_STORAGE_KEY}?download=1`,
          },
        },
      },
      delay: IMAGE_SAVING_TO_READY_DELAY,
    },
  )

  return chunks
}

function getChunksForScenario(
  scenario: Scenario,
  effort: ReasoningLevel,
  imageReasoningFirst: boolean,
): TimedChunk[] {
  const effectiveScenario = scenario === 'reasoning' && effort === 'off'
    ? 'short'
    : scenario

  switch (effectiveScenario) {
    case 'short':
      return buildTextChunks(SHORT_TEXT, 'test-text-0')
    case 'long': {
      const chunks: TimedChunk[] = []
      const fullText = LONG_TEXT.join('\n\n')

      chunks.push(...buildTextChunks(fullText, 'test-text-0'))

      return chunks
    }
    case 'reasoning': {
      const chunks: TimedChunk[] = []
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
    case 'image':
      return buildImageGenerationChunks({
        withReasoningFirst: imageReasoningFirst,
      })
    default:
      return buildTextChunks(SHORT_TEXT, 'test-text-0')
  }
}

function getErrorChunks(errorText: string): TimedChunk[] {
  return [
    {
      chunk: {
        type: 'source-url',
        sourceId: 'test-source-1',
        url: 'https://example.com/test-source',
        title: 'Test source',
      },
    },
    ...buildTextChunks(
      'This is partial assistant output before the simulated failure.',
      'test-text-error',
    ),
    {
      chunk: {
        type: 'error',
        errorText,
      },
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
      .enum(chatTestScenarios)
      .default('short'),
    messages: z.string().regex(/^\d+$/).default('1').transform(Number),
    effort: z.enum(['off', 'low', 'medium', 'high']).default('medium'),
    error: z.enum(chatTestErrorIds).optional(),
    imageReasoningFirst: z
      .enum(['true', 'false'])
      .default('false')
      .transform(value => value === 'true'),
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

  const timedChunks = errorId
    ? getErrorChunks(JSON.stringify(toChatTestErrorPayload(
      errorId,
      requestId,
    )))
    : getChunksForScenario(
      query.data.scenario,
      query.data.effort,
      query.data.imageReasoningFirst,
    )

  const stream = createUIMessageStream({
    execute({ writer }) {
      const readable = new ReadableStream<UIMessageChunk>({
        async start(controller) {
          await delay(INITIAL_DELAY)
          let previousType: string = ''

          for (const { chunk, delay: explicitDelay } of timedChunks) {
            if (
              previousType === 'reasoning-end'
              && (
                chunk.type === 'text-start'
                || chunk.type === 'reasoning-start'
              )
            ) {
              await delay(REASONING_STEP_DELAY)
            }

            const chunkDelay = explicitDelay ?? (
              chunk.type.startsWith('reasoning')
                ? REASONING_CHUNK_DELAY
                : TEXT_CHUNK_DELAY
            )

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
