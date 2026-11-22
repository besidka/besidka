import {
  TOOL_APPROVAL_CLAIM_STATUSES,
  TOOL_PERMISSION_MODES,
} from '#shared/utils/tool-approval-policy'
import {
  snakeCase, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { defaultSchema, defaultSchemaTimestamps } from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'

export const besidkaToolPermissions = snakeCase.table(
  'besidka_tool_permissions',
  {
    ...defaultSchema,
    userId: integer({ mode: 'number' }).notNull(),
    toolName: text().notNull(),
    mode: text({ enum: TOOL_PERMISSION_MODES }).notNull(),
  },
  table => [
    uniqueIndex('uq_besidka_tool_permissions_user_tool')
      .on(table.userId, table.toolName),
  ],
)

export const besidkaChatSettings = snakeCase.table(
  'besidka_chat_settings',
  {
    ...defaultSchema,
    userId: integer({ mode: 'number' }).notNull(),
    chatPublicId: publicId().notNull(),
    enabled: integer({ mode: 'boolean' }).notNull(),
    alwaysAllowTools: text({ mode: 'json' })
      .$type<Record<string, string>>()
      .notNull(),
  },
  table => [
    uniqueIndex('uq_besidka_chat_settings_user_chat')
      .on(table.userId, table.chatPublicId),
  ],
)

export const toolApprovalClaims = snakeCase.table(
  'tool_approval_claims',
  {
    approvalId: text().primaryKey(),
    userId: integer({ mode: 'number' }).notNull(),
    chatPublicId: publicId().notNull(),
    messagePublicId: text().notNull(),
    status: text({ enum: TOOL_APPROVAL_CLAIM_STATUSES }).notNull(),
    ...defaultSchemaTimestamps,
  },
  table => [
    index('idx_tool_approval_claims_created').on(table.createdAt),
  ],
)
