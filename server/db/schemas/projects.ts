import {
  snakeCase, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import { knowledgeModes } from '#shared/utils/project-knowledge-policy'
import { users } from './auth'
import { defaultSchemaWithPublicId } from '../../utils/schema'

export const projects = snakeCase.table(
  'projects',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    instructions: text(),
    memory: text(),
    memoryStatus: text({
      enum: [
        'idle',
        'stale',
        'refreshing',
        'ready',
        'failed',
        'unavailable',
        'disabled',
      ],
    })
      .notNull()
      .default('idle'),
    memoryUpdatedAt: integer({ mode: 'timestamp' }),
    memoryDirtyAt: integer({ mode: 'timestamp' }),
    memoryProvider: text(),
    memoryModel: text(),
    memoryError: text(),
    useAccountMemory: integer({ mode: 'boolean' }),
    memoryMigratedAt: integer({ mode: 'timestamp' }),
    knowledgeMode: text({ enum: knowledgeModes }),
    knowledgeVersion: integer({ mode: 'number' }),
    knowledgePackVersion: integer({ mode: 'number' }),
    pinnedAt: integer({ mode: 'timestamp' }),
    archivedAt: integer({ mode: 'timestamp' }),
    activityAt: integer({ mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  table => [
    uniqueIndex('uq_project_user').on(table.id, table.userId),
    index('idx_projects_activity_at').on(table.activityAt),
  ],
)
