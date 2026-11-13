import {
  SKILL_CREATED_VIA,
  SKILL_FILE_KINDS,
  SKILL_LICENSE_CLASSES,
  SKILL_SOURCE_KINDS,
  SKILL_STATUSES,
  SKILL_VERSION_ORIGINS,
} from '#shared/utils/skills-policy'
import {
  snakeCase, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import {
  defaultSchemaCreatedAtOnly,
  defaultSchemaIdOnly,
  defaultSchemaWithPublicId,
} from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'

export const skills = snakeCase.table(
  'skills',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' }).notNull(),
    name: text().notNull(),
    description: text().notNull(),
    licenseField: text(),
    licenseClass: text({ enum: SKILL_LICENSE_CLASSES }).notNull(),
    licenseFileSha256: text(),
    licenseClassifierVersion: integer({ mode: 'number' }).notNull(),
    compatibility: text(),
    metadata: text({ mode: 'json' }).$type<Record<string, string>>(),
    allowedTools: text({ mode: 'json' }).$type<string[]>(),
    sourceKind: text({ enum: SKILL_SOURCE_KINDS }).notNull(),
    sourceUrl: text(),
    sourceRef: text(),
    sourceVersion: text(),
    sourcePath: text(),
    currentVersion: integer({ mode: 'number' }).notNull(),
    pendingVersion: integer({ mode: 'number' }),
    filesCount: integer({ mode: 'number' }).notNull(),
    bytes: integer({ mode: 'number' }).notNull(),
    enabled: integer({ mode: 'boolean' })
      .notNull()
      .$defaultFn(() => false),
    modelInvocable: integer({ mode: 'boolean' })
      .notNull()
      .$defaultFn(() => false),
    slashCommand: integer({ mode: 'boolean' })
      .notNull()
      .$defaultFn(() => false),
    argumentHint: text(),
    allowScripts: integer({ mode: 'boolean' })
      .notNull()
      .$defaultFn(() => false),
    status: text({ enum: SKILL_STATUSES }).notNull(),
    createdVia: text({ enum: SKILL_CREATED_VIA }).notNull(),
    createdByClientId: text(),
    providerSkillId: text(),
    providerSkillVersion: text(),
    providerUploadedName: text(),
    providerDeletedAt: integer({ mode: 'timestamp' }),
  },
  table => [
    uniqueIndex('uq_skills_user_name').on(table.userId, table.name),
    index('idx_skills_user_updated').on(table.userId, table.updatedAt),
  ],
)

export const skillVersions = snakeCase.table(
  'skill_versions',
  {
    ...defaultSchemaIdOnly,
    skillId: publicId().notNull(),
    userId: integer({ mode: 'number' }).notNull(),
    version: integer({ mode: 'number' }).notNull(),
    origin: text({ enum: SKILL_VERSION_ORIGINS }).notNull(),
    createdByClientId: text(),
    sourceVersion: text(),
    sha256: text().notNull(),
    filesCount: integer({ mode: 'number' }).notNull(),
    bytes: integer({ mode: 'number' }).notNull(),
    licenseClass: text({ enum: SKILL_LICENSE_CLASSES }).notNull(),
    licenseFileSha256: text(),
    findings: text({ mode: 'json' }).$type<Record<string, number>>(),
    note: text(),
    ...defaultSchemaCreatedAtOnly,
  },
  table => [
    uniqueIndex('uq_skill_versions_skill_version')
      .on(table.skillId, table.version),
    index('idx_skill_versions_user').on(table.userId),
  ],
)

export const skillFiles = snakeCase.table(
  'skill_files',
  {
    ...defaultSchemaIdOnly,
    skillId: publicId().notNull(),
    userId: integer({ mode: 'number' }).notNull(),
    version: integer({ mode: 'number' }).notNull(),
    path: text().notNull(),
    blobSha256: text().notNull(),
    bytes: integer({ mode: 'number' }).notNull(),
    kind: text({ enum: SKILL_FILE_KINDS }).notNull(),
  },
  table => [
    uniqueIndex('uq_skill_files_skill_version_path')
      .on(table.skillId, table.version, table.path),
    index('idx_skill_files_user').on(table.userId),
    index('idx_skill_files_skill_blob').on(table.skillId, table.blobSha256),
  ],
)

export const skillChatSettings = snakeCase.table(
  'skill_chat_settings',
  {
    ...defaultSchemaIdOnly,
    userId: integer({ mode: 'number' }).notNull(),
    chatPublicId: publicId().notNull(),
    skillId: publicId().notNull(),
    enabled: integer({ mode: 'boolean' }).notNull(),
    ...defaultSchemaCreatedAtOnly,
    updatedAt: integer({ mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  table => [
    uniqueIndex('uq_skill_chat_settings_chat_skill')
      .on(table.chatPublicId, table.skillId),
    index('idx_skill_chat_settings_user').on(table.userId),
    index('idx_skill_chat_settings_skill').on(table.skillId),
  ],
)
