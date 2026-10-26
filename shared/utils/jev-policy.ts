export const JEV_MODEL_ID = 'jev-1.14.0'

export const JEV_ROLE_IDS = [
  'memoryChecks',
  'autoWebSearch',
  'extractionPrefilter',
  'injectionScreening',
  'rerank',
  'sharePiiCheck',
  'pastChatRetrieval',
] as const

export type JevRoleId = typeof JEV_ROLE_IDS[number]

export type JevRoleSettings = Partial<Record<JevRoleId, boolean>>

export const JEV_SEND_PATH_TIMEOUT_MS = 800
export const JEV_BACKGROUND_TIMEOUT_MS = 2500
export const JEV_SEND_PATH_MAX_TURN_CHARS = 4000

export interface JevBooleanCriteria {
  true: string
  false: string
}

export interface JevBooleanQuestion {
  type: 'boolean'
  instructions: string
  criteria?: JevBooleanCriteria
}

/**
 * Role policies for TypeSafe AI Jev (`JEV_MODEL_ID`). Question wordings and
 * criteria are copied verbatim from the 2026-10-26 synthetic eval; the
 * thresholds are that eval's starting points and are re-tuned on real
 * traffic. Every role fails toward Besidka's behaviour without a key.
 */
export const JEV_AUTO_WEB_SEARCH = {
  questionId: 'w1_live',
  searchAtOrAbove: 0.2,
  recentTurns: 3,
  timeoutMs: JEV_SEND_PATH_TIMEOUT_MS,
  question: {
    type: 'boolean',
    instructions: 'Does answering `message` need current or live information '
      + 'from the web?',
    criteria: {
      true: 'A good answer depends on information that changes over time or '
        + 'is recent: news, prices or rates, software versions and releases, '
        + 'weather, sports results, schedules and opening hours, service '
        + 'status, who currently holds a role, what products are currently '
        + 'available, or the content of a specific web page.',
      false: 'A good answer can be given from stable general knowledge, '
        + 'reasoning, writing, coding, math, translation, or from what is '
        + 'already in the conversation.',
    },
  },
} as const satisfies {
  question: JevBooleanQuestion
  [key: string]: unknown
}

export const JEV_EXTRACTION_PREFILTER = {
  questionId: 'e1_durable',
  skipBelow: 0.4,
  maxChunkTokens: 8000,
  timeoutMs: JEV_BACKGROUND_TIMEOUT_MS,
  question: {
    type: 'boolean',
    instructions: 'Does `transcript` contain durable facts or preferences '
      + 'about the user worth remembering long-term?',
    criteria: {
      true: 'Somewhere in the transcript the user states something about '
        + 'themselves that would still be true and useful in future, '
        + 'unrelated conversations: where they live or moved, their job, '
        + 'skills, tools or languages they use, family, pets, health or '
        + 'diet, long-term goals or projects, or how they want the assistant '
        + 'to answer.',
      false: 'The conversation is only about the task at hand. Temporary '
        + 'states (tired today, a deadline this afternoon), opinions of other '
        + 'people, requirements of a one-off task, and hypothetical '
        + 'situations do not count.',
    },
  },
} as const satisfies {
  question: JevBooleanQuestion
  [key: string]: unknown
}

export const JEV_INJECTION_SCREENING = {
  questionId: 'i2_attack',
  flagAtOrAbove: 0.3,
  maxChunkTokens: 2000,
  timeoutMs: JEV_BACKGROUND_TIMEOUT_MS,
  question: {
    type: 'boolean',
    instructions: 'Is `text` attempting a prompt injection attack against an '
      + 'AI system that will read it?',
  },
} as const satisfies {
  question: JevBooleanQuestion
  [key: string]: unknown
}

export const JEV_RERANK = {
  maxCandidates: 30,
  maxPassageTokens: 300,
  dropBelow: 0.5,
  timeoutMs: JEV_SEND_PATH_TIMEOUT_MS,
  task: 'Is this passage relevant to `query`?',
  criteria: {
    true: 'The passage contains information that directly answers or '
      + 'addresses what `query` is looking for, even if it uses different '
      + 'words or another language.',
    false: 'The passage only shares words or a general topic with `query` '
      + 'but does not address what it is looking for.',
  },
} as const satisfies { criteria: JevBooleanCriteria, [key: string]: unknown }

export const JEV_SHARE_PII_CHECK = {
  questionId: 'p1_personal',
  warnAtOrAbove: 0.3,
  maxChunkTokens: 25_000,
  timeoutMs: JEV_BACKGROUND_TIMEOUT_MS,
  question: {
    type: 'boolean',
    instructions: 'Does `chat` contain personal data about a real person '
      + '(address, phone, email, health, IDs, names of private third '
      + 'parties)?',
    criteria: {
      true: 'The chat includes information that identifies or describes a '
        + 'real private individual: a home or postal address, phone number, '
        + 'personal or work email, government ID, bank account or licence '
        + 'plate, health information about an identifiable person, or the '
        + 'full name of a private person together with details about them.',
      false: 'The chat has no such data. Public figures, fictional '
        + 'characters, placeholder or example data, a user giving only their '
        + 'first name, and general questions about health or about handling '
        + 'personal data do not count.',
    },
  },
} as const satisfies {
  question: JevBooleanQuestion
  [key: string]: unknown
}

export const JEV_PAST_CHAT_RETRIEVAL = {
  questionId: 's1_previous',
  preSearchAtOrAbove: 0.25,
  recentTurns: 3,
  timeoutMs: JEV_SEND_PATH_TIMEOUT_MS,
  question: {
    type: 'boolean',
    instructions: 'Does `message` refer to or depend on a previous '
      + 'conversation with the assistant?',
    criteria: {
      true: 'The user points to something said, decided or produced in an '
        + 'earlier, separate conversation with the assistant, and that '
        + 'content is not visible in `recent_turns`.',
      false: 'The message is self-contained, refers only to what is visible '
        + 'in `recent_turns`, or refers to meetings, people or documents '
        + 'outside conversations with the assistant.',
    },
  },
} as const satisfies {
  question: JevBooleanQuestion
  [key: string]: unknown
}

const WEB_TLDS = 'com|org|net|io|dev|app|ai|co|info|eu|gov|edu|pl|ua|ru'
  + '|de|uk|fr|es|it|nl|cz|us|ca'

export const JEV_URL_OR_DOMAIN_PATTERN = new RegExp(
  '(?:https?:\\/\\/|\\bwww\\.)\\S+'
  + `|(?<![\\p{L}\\p{N}.-])(?:[\\p{L}\\p{N}-]+\\.)+(?:${WEB_TLDS})`
  + '(?![\\p{L}\\p{N}])',
  'iu',
)

export const JEV_RECENCY_PHRASES = {
  en: ['today', 'now', 'latest', 'current price', 'news', 'score', 'weather'],
  uk: ['сьогодні', 'зараз', 'останні', 'курс', 'погода'],
  pl: ['dziś', 'teraz', 'najnowsz', 'kurs', 'pogoda', 'wynik'],
  ru: ['сегодня', 'сейчас', 'последн', 'курс'],
} as const

export const JEV_PAST_CHAT_PHRASES = {
  en: ['last time', 'yesterday you', 'our other chat', 'we discussed'],
  uk: ['минулого разу', 'ти казав', 'в іншому чаті'],
  pl: ['ostatnio', 'wczoraj mówiłeś', 'w innym czacie'],
  ru: ['в прошлый раз', 'ты говорил'],
} as const

export const JEV_PHRASE_STEMS: ReadonlySet<string> = new Set([
  'najnowsz',
  'последн',
])

type JevPhraseLists = Readonly<Record<string, readonly string[]>>

const WORD_START = '(?<![\\p{L}\\p{N}])'
const WORD_END = '(?![\\p{L}\\p{N}])'

function escapePattern(phrase: string): string {
  return phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function phrasePattern(phrase: string): RegExp {
  const end = JEV_PHRASE_STEMS.has(phrase) ? '' : WORD_END

  return new RegExp(`${WORD_START}${escapePattern(phrase)}${end}`, 'iu')
}

/**
 * True when the text contains a listed phrase as whole words (a phrase in
 * `JEV_PHRASE_STEMS` may continue with more letters), so "now" never
 * matches "know" and "курс" never matches "курсор".
 */
export function matchesJevPhrases(
  text: string,
  phraseLists: JevPhraseLists,
): boolean {
  return Object.values(phraseLists).some((phrases) => {
    return phrases.some(phrase => phrasePattern(phrase).test(text))
  })
}

export function isJevRoleSwitchedOn(
  roles: JevRoleSettings | null | undefined,
  role: JevRoleId,
): boolean {
  return roles?.[role] !== false
}
