import type { ReasoningUIPart, SourceUrlUIPart, TextUIPart } from 'ai'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { ResearchBriefData, ResearchDepth } from '#shared/types/research.d'
import { chatTestErrorIds } from '#shared/utils/chat-test-errors'
import { getReasoningStepsCount } from '~~/server/utils/chats/test/steps-count'
import { getResearchStepsCount } from '~~/server/utils/chats/test/research-steps-count'

const shortMessage = 'Test message'
const longMessage = `Here is text with three paragraphs:

The sun dipped below the horizon, painting the sky in hues of fiery orange and soft lavender. A gentle breeze rustled through the leaves of the ancient oak tree, its branches reaching like gnarled fingers towards the twilight. The scent of damp earth and blooming jasmine filled the air, creating a tranquil atmosphere that invited reflection. As the first stars began to twinkle, a sense of quiet peace settled over the landscape, a perfect prelude to the approaching night.

Across the meadow, a small cottage stood bathed in the fading light. Smoke curled lazily from its chimney, a sign of warmth and life within. Inside, a family was gathering for supper, their laughter and conversation weaving a tapestry of everyday joy. The simple act of sharing a meal, surrounded by loved ones, held a profound beauty that transcended material possessions. It was in these moments of connection that true contentment could be found.`

const researchTopic = 'the impact of remote work on team productivity'

const researchSources: Array<{ url: string, title: string }> = [
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

const researchReport = `## Deep research report

### Key findings
- Remote work shows mixed effects on productivity depending on role.
- Structured communication rituals reduce coordination overhead.
- Employee wellbeing correlates positively with sustained output.

### Sources
Findings are cross-checked against the search results collected above.`

function getResearchSourcesCount(depth: ResearchDepth): number {
  const phaseRepeatsCount = Math.floor((getResearchStepsCount(depth) - 3) / 2)

  return Math.min(researchSources.length, phaseRepeatsCount * 2)
}

interface ResearchBriefUIPart {
  type: 'data-research-brief'
  data: ResearchBriefData
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

  const { scenario, messages, effort, depth, error } = query.data
  const effectiveScenario = scenario === 'reasoning' && effort === 'off'
    ? 'short'
    : scenario
  const isDeepResearch = effectiveScenario === 'deep-research'
  const text = effectiveScenario === 'long'
    ? longMessage
    : isDeepResearch
      ? researchReport
      : shortMessage
  const reasoningStepsCount = getReasoningStepsCount(effort)
  const researchSourcesCount = getResearchSourcesCount(depth)
  const researchBrief: ResearchBriefData = {
    topic: researchTopic,
    depth,
    answers: [],
  }
  const reasoningLevel: ReasoningLevel = effectiveScenario === 'reasoning'
    ? effort
    : 'off'
  const scenarioKey = effectiveScenario === 'reasoning'
    ? `${effectiveScenario}-${effort}`
    : isDeepResearch
      ? `${effectiveScenario}-${depth}`
      : effectiveScenario
  const testKey = error
    ? `${scenarioKey}-error-${error}`
    : scenarioKey

  return {
    id: `test-chat-${testKey}`,
    slug: `test-chat-${testKey}`,
    title: `Test Chat - ${testKey}`,
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
          ...(role === 'assistant' && isDeepResearch
            ? Array.from(
              { length: researchSourcesCount },
              (_, sourceIndex) => {
                const source
                  = researchSources[sourceIndex % researchSources.length]!

                return {
                  type: 'source-url',
                  sourceId: `test-research-source-${sourceIndex + 1}`,
                  url: source.url,
                  title: source.title,
                }
              },
            ) as SourceUrlUIPart[]
            : []),
          ...(role === 'assistant' && isDeepResearch
            ? [{
              type: 'data-research-brief',
              data: researchBrief,
            }] as ResearchBriefUIPart[]
            : []),
          {
            type: 'text',
            text: isDeepResearch && role === 'user'
              ? researchTopic
              : text,
          } as TextUIPart,
        ],
        tools: [],
        reasoning: reasoningLevel,
      }
    }),
  }
})
