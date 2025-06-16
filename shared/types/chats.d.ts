import * as schema from '~~/server/db/schema'

export type Message = typeof schema.messages.$inferSelect

export type Chat = typeof schema.chats.$inferSelect & {
  messages: Message[]
}
