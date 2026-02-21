const shortMessage = 'test first message in the chat'
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
  }).safeParse)

  if (query.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request query',
      data: query.error,
    })
  }

  const { scenario, messages } = query.data
  const text = scenario === 'short' ? shortMessage : longMessage

  return {
    id: `test-chat-${scenario}`,
    slug: `test-chat-${scenario}`,
    title: `Test Chat - ${scenario}`,
    messages: Array.from({ length: messages }, (_, index) => ({
      id: `test-chat-${scenario}-message-${index + 1}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      parts: [
        ...(index % 2 === 0 && scenario === 'reasoning'
          ? [{
            type: 'reasoning',
            reasoning: {
              thought: `Thought for message ${index + 1}`,
              plan: `Plan for message ${index + 1}`,
              conclusion: `Conclusion for message ${index + 1}`,
            },
          }]
          : []),
        {
          type: 'text',
          text,
        },
      ],
      tools: [],
      reasoning: scenario === 'reasoning',
    })),
  }
})
