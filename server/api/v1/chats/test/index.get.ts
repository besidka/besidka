import type { ReasoningUIPart, TextUIPart } from 'ai'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import { getReasoningStepsCount } from '~~/server/utils/chats/test/steps-count'

const shortMessage = 'Test message'
const longMessage = `Here is text with three paragraphs:

The sun dipped below the horizon, painting the sky in hues of fiery orange and soft lavender. A gentle breeze rustled through the leaves of the ancient oak tree, its branches reaching like gnarled fingers towards the twilight. The scent of damp earth and blooming jasmine filled the air, creating a tranquil atmosphere that invited reflection. As the first stars began to twinkle, a sense of quiet peace settled over the landscape, a perfect prelude to the approaching night.

Across the meadow, a small cottage stood bathed in the fading light. Smoke curled lazily from its chimney, a sign of warmth and life within. Inside, a family was gathering for supper, their laughter and conversation weaving a tapestry of everyday joy. The simple act of sharing a meal, surrounded by loved ones, held a profound beauty that transcended material possessions. It was in these moments of connection that true contentment could be found.`

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

  const { scenario, messages, effort } = query.data
  const effectiveScenario = scenario === 'reasoning' && effort === 'off'
    ? 'short'
    : scenario
  const text = effectiveScenario === 'long'
    ? longMessage
    : shortMessage
  const reasoningStepsCount = getReasoningStepsCount(effort)
  const reasoningLevel: ReasoningLevel = effectiveScenario === 'reasoning'
    ? effort
    : 'off'
  const scenarioKey = effectiveScenario === 'reasoning'
    ? `${effectiveScenario}-${effort}`
    : effectiveScenario

  return {
    id: `test-chat-${scenarioKey}`,
    slug: `test-chat-${scenarioKey}`,
    title: `Test Chat - ${scenarioKey}`,
    messages: Array.from({ length: messages }, (_, index) => {
      const role = index % 2 === 0 ? 'user' : 'assistant'

      return {
        id: `test-chat-${scenarioKey}-message-${index + 1}`,
        role,
        parts: [
          ...(role === 'assistant' && effectiveScenario === 'reasoning'
            ? Array.from({ length: reasoningStepsCount }, (_, stepIndex) => ({
              type: 'reasoning',
              text: `**Step ${stepIndex + 1}**\n\nThis is the reasoning for step ${stepIndex + 1}. It provides insights and explanations related to the user's message, helping to break down complex ideas into more digestible parts.`,
              state: 'done',
            })) as ReasoningUIPart[]
            : []),
          {
            type: 'text',
            text,
          } as TextUIPart,
        ],
        tools: [],
        reasoning: reasoningLevel,
      }
    }),
  }
})
