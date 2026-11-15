import { PROJECT_SKILL_LEVELS } from '#shared/utils/skills-policy'
import {
  snakeCase, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import {
  defaultSchemaCreatedAtOnly,
  defaultSchemaIdOnly,
} from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'

export const projectSkills = snakeCase.table(
  'project_skills',
  {
    ...defaultSchemaIdOnly,
    projectId: publicId().notNull(),
    skillId: publicId().notNull(),
    userId: integer({ mode: 'number' }).notNull(),
    level: text({ enum: PROJECT_SKILL_LEVELS }).notNull(),
    position: integer({ mode: 'number' }).notNull(),
    ...defaultSchemaCreatedAtOnly,
  },
  table => [
    uniqueIndex('uq_project_skills_project_skill')
      .on(table.projectId, table.skillId),
    index('idx_project_skills_user').on(table.userId),
    index('idx_project_skills_skill').on(table.skillId),
  ],
)
