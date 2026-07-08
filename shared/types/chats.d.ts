import * as schema from '~~/server/db/schema'
import type { ResearchJobView } from './research.d'

export type Message = typeof schema.messages.$inferSelect

export type Chat = typeof schema.chats.$inferSelect & {
  messages: Message[]
  activeResearchJob?: ResearchJobView | null
}

export type Tools = Message['tools']
