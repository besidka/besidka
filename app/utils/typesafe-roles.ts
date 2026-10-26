import type { JevRoleId } from '#shared/utils/jev-policy'

export interface TypesafeRoleCopy {
  id: JevRoleId
  title: string
  description: string
}

export const typesafeRoleCopies: TypesafeRoleCopy[] = [
  {
    id: 'memoryChecks',
    title: 'Memory checks',
    description: 'When you save memory, Besidka sends the candidate entry '
      + 'text to TypeSafe AI (US) to double-check it for sensitive data and to '
      + 'confirm it really comes from your conversation. If TypeSafe AI '
      + 'doesn\'t answer, Besidka\'s own checks still run.',
  },
  {
    id: 'autoWebSearch',
    title: 'Auto web search',
    description: 'Decides per message whether a web search is needed. Sends '
      + 'your message and the last few turns. If TypeSafe AI doesn\'t answer, '
      + 'Besidka searches as usual. Pick Auto in the chat\'s web search menu '
      + 'to use it.',
  },
  {
    id: 'extractionPrefilter',
    title: 'Memory pre-filter',
    description: 'Before memory is generated from a chat, checks whether it '
      + 'has anything worth remembering. Sends the chat text after passwords '
      + 'and card numbers are removed. If unsure or unavailable, memory is '
      + 'generated as usual.',
  },
  {
    id: 'injectionScreening',
    title: 'Prompt-injection screening',
    description: 'Checks project files, notes and Brave/Exa results for '
      + 'hidden instructions aimed at the AI. Sends that text. Flagged files '
      + 'wait for your review; results from your model\'s own web search '
      + 'can\'t be checked.',
  },
  {
    id: 'rerank',
    title: 'Search re-ranking',
    description: 'Puts the most relevant past chats and project file excerpts '
      + 'first. Sends your search query and short excerpts. If TypeSafe AI '
      + 'doesn\'t answer, results keep their usual order.',
  },
  {
    id: 'sharePiiCheck',
    title: 'Share check',
    description: 'Before you share a chat, checks it for personal data and '
      + 'warns you. Sends the chat text being shared. Never blocks sharing.',
  },
  {
    id: 'pastChatRetrieval',
    title: 'Past-chat retrieval',
    description: 'For models without tool calling, finds relevant past chats '
      + 'when you refer to them. Sends your message and recent turns. If '
      + 'TypeSafe AI doesn\'t answer, Besidka searches your past chats '
      + 'anyway.',
  },
]
