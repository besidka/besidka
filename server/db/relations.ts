import { defineRelations } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

export const relations = defineRelations(schema, r => ({
  users: {
    accounts: r.many.accounts({
      from: r.users.id,
      to: r.accounts.userId,
    }),
    sessions: r.many.sessions({
      from: r.users.id,
      to: r.sessions.userId,
    }),
    chats: r.many.chats({
      from: r.users.id,
      to: r.chats.userId,
    }),
    chat: r.one.chats({
      from: r.users.id,
      to: r.chats.userId,
      optional: true,
    }),
    keys: r.many.keys({
      from: r.users.id,
      to: r.keys.userId,
    }),
    key: r.one.keys({
      from: r.users.id,
      to: r.keys.userId,
      optional: true,
    }),
    files: r.many.files({
      from: r.users.id,
      to: r.files.userId,
    }),
    file: r.one.files({
      from: r.users.id,
      to: r.files.userId,
      optional: true,
    }),
    storage: r.one.storages({
      from: r.users.id,
      to: r.storages.userId,
      optional: true,
    }),
    settings: r.one.userSettings({
      from: r.users.id,
      to: r.userSettings.userId,
      optional: true,
    }),
  },
  accounts: {
    user: r.one.users({
      from: r.accounts.userId,
      to: r.users.id,
      optional: false,
    }),
  },
  sessions: {
    user: r.one.users({
      from: r.sessions.userId,
      to: r.users.id,
      optional: false,
    }),
  },
  chats: {
    user: r.one.users({
      from: r.chats.userId,
      to: r.users.id,
      optional: false,
    }),
    messages: r.many.messages({
      from: r.chats.id,
      to: r.messages.chatId,
    }),
    shares: r.many.chatShares({
      from: r.chats.id,
      to: r.chatShares.chatId,
    }),
    project: r.one.projects({
      from: r.chats.projectId,
      to: r.projects.id,
      optional: true,
    }),
    researchJobs: r.many.researchJobs({
      from: r.chats.id,
      to: r.researchJobs.chatId,
    }),
  },
  messages: {
    chat: r.one.chats({
      from: r.messages.chatId,
      to: r.chats.id,
      optional: false,
    }),
  },
  researchJobs: {
    chat: r.one.chats({
      from: r.researchJobs.chatId,
      to: r.chats.id,
      optional: false,
    }),
  },
  chatShares: {
    chat: r.one.chats({
      from: r.chatShares.chatId,
      to: r.chats.id,
      optional: false,
    }),
    files: r.many.chatShareFiles({
      from: r.chatShares.id,
      to: r.chatShareFiles.chatShareId,
    }),
  },
  chatShareFiles: {
    share: r.one.chatShares({
      from: r.chatShareFiles.chatShareId,
      to: r.chatShares.id,
      optional: false,
    }),
    file: r.one.files({
      from: r.chatShareFiles.fileId,
      to: r.files.id,
      optional: false,
    }),
  },
  files: {
    user: r.one.users({
      from: r.files.userId,
      to: r.users.id,
      optional: false,
    }),
    originMessage: r.one.messages({
      from: r.files.originMessageId,
      to: r.messages.id,
      optional: true,
    }),
    shares: r.many.chatShareFiles({
      from: r.files.id,
      to: r.chatShareFiles.fileId,
    }),
  },
  storages: {
    user: r.one.users({
      from: r.storages.userId,
      to: r.users.id,
      optional: false,
    }),
  },
  keys: {
    user: r.one.users({
      from: r.keys.userId,
      to: r.users.id,
      optional: false,
    }),
  },
  projects: {
    user: r.one.users({
      from: r.projects.userId,
      to: r.users.id,
      optional: false,
    }),
    chats: r.many.chats({
      from: r.projects.id,
      to: r.chats.projectId,
    }),
  },
  userSettings: {
    user: r.one.users({
      from: r.userSettings.userId,
      to: r.users.id,
      optional: false,
    }),
  },
}))
