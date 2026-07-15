import type { LanguageModel } from 'ai'
import type {
  ResearchAnswer,
  ResearchClarificationResponse,
} from '#shared/types/research.d'
import { generateObject, generateText } from 'ai'

interface GenerateResearchClarificationsInput {
  instance: LanguageModel
  topic: string
}

export async function generateResearchClarifications(
  input: GenerateResearchClarificationsInput,
): Promise<ResearchClarificationResponse> {
  const schema = z.object({
    questions: z.array(z.object({
      id: z.string(),
      question: z.string(),
      kind: z.enum(['choice', 'text']),
      options: z.array(z.string()).optional(),
      placeholder: z.string().optional(),
    })).min(2).max(4),
    note: z.string().optional(),
  })

  const prompt = [
    'A user wants a deep research report on the topic below.',
    'Generate 2 to 4 short clarifying questions that would meaningfully',
    'narrow the scope (audience, timeframe, geography, depth, or angle).',
    'Mix question kinds: use "choice" with 3 to 5 concise options when a',
    'small set of answers fits, and "text" for open-ended specifics.',
    'Give each question a stable, unique id.',
    '',
    `Topic: ${input.topic}`,
  ].join('\n')

  const { object } = await generateObject({
    model: input.instance,
    schema,
    schemaName: 'ResearchClarifications',
    prompt,
    providerOptions: {
      openai: {
        strictJsonSchema: false,
      },
    },
  })

  return object
}

interface RewriteResearchBriefInput {
  instance: LanguageModel
  topic: string
  answers: ResearchAnswer[]
}

export async function rewriteResearchBrief(
  input: RewriteResearchBriefInput,
): Promise<string> {
  const { text } = await generateText({
    model: input.instance,
    prompt: buildRewritePrompt(input.topic, input.answers),
  })

  return text.trim()
}

function buildRewritePrompt(
  topic: string,
  answers: ResearchAnswer[],
): string {
  const lines = [
    'Rewrite the research request below into a single, maximally specific',
    'research brief written in first person, as if the user were asking a',
    'researcher directly. Expand on the topic and the clarifying answers',
    'below, but never invent facts, preferences, or constraints the user',
    'did not state. Where a dimension of the topic is genuinely unstated,',
    'explicitly mark it as open-ended rather than guessing.',
    'Use tables or headings in the brief itself where they would help',
    'organize distinct sub-questions. Explicitly request that the final',
    'report include inline citations for every factual claim.',
    'Return only the rewritten brief, with no preamble or explanation.',
    '',
    `Topic: ${topic}`,
  ]

  if (answers.length > 0) {
    lines.push('', 'Clarifying answers:')

    for (const answer of answers) {
      lines.push(`- ${answer.question} -> ${answer.answer}`)
    }
  }

  return lines.join('\n')
}
