import {
  CONNECTOR_AUDIT_APPROVALS,
  CONNECTOR_AUDIT_OUTCOMES,
  CONNECTOR_AUDIT_PATHS,
  CONNECTOR_AUTH_TYPES,
  CONNECTOR_CREATED_VIA,
  CONNECTOR_REGISTRY_REMOTE_TYPES,
  CONNECTOR_STATUSES,
  CONNECTOR_TOOL_APPROVALS,
  CONNECTOR_TRANSPORTS,
} from '#shared/utils/connectors-policy'
import {
  snakeCase, text, integer, uniqueIndex, index,
} from 'drizzle-orm/sqlite-core'
import {
  defaultSchemaCreatedAtOnly,
  defaultSchemaIdOnly,
  defaultSchemaWithPublicId,
} from '../../utils/schema'
import { publicId } from '../../utils/custom-db-types'

export interface ConnectorLastError {
  code: string
  message: string
  degraded?: string
}

export const connectors = snakeCase.table(
  'connectors',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' }).notNull(),
    slug: text().notNull(),
    title: text().notNull(),
    origin: text().notNull(),
    urlEncrypted: text().notNull(),
    transport: text({ enum: CONNECTOR_TRANSPORTS }).notNull(),
    authType: text({ enum: CONNECTOR_AUTH_TYPES }),
    status: text({ enum: CONNECTOR_STATUSES }).notNull(),
    enabled: integer({ mode: 'boolean' }).notNull(),
    presetId: text(),
    createdVia: text({ enum: CONNECTOR_CREATED_VIA }).notNull(),
    createdByClientId: text(),
    consentOrigin: text(),
    consentIssuer: text(),
    consentVersion: text(),
    consentedAt: integer({ mode: 'timestamp' }),
    consentWithdrawnAt: integer({ mode: 'timestamp' }),
    nativeOptInAt: integer({ mode: 'timestamp' }),
    lastError: text({ mode: 'json' }).$type<ConnectorLastError>(),
    lastConnectedAt: integer({ mode: 'timestamp' }),
  },
  table => [
    uniqueIndex('uq_connectors_user_slug').on(table.userId, table.slug),
    index('idx_connectors_user_updated').on(table.userId, table.updatedAt),
  ],
)

export const connectorCredentials = snakeCase.table(
  'connector_credentials',
  {
    ...defaultSchemaWithPublicId,
    connectorId: publicId().notNull(),
    userId: integer({ mode: 'number' }).notNull(),
    issuer: text().notNull(),
    clientRegistration: text(),
    accessToken: text(),
    refreshToken: text(),
    headerName: text(),
    headerValue: text(),
    scope: text(),
    expiresAt: integer({ mode: 'timestamp' }),
  },
  table => [
    uniqueIndex('uq_connector_credentials_connector_issuer')
      .on(table.connectorId, table.issuer),
    index('idx_connector_credentials_user').on(table.userId),
  ],
)

export const connectorToolSettings = snakeCase.table(
  'connector_tool_settings',
  {
    ...defaultSchemaWithPublicId,
    connectorId: publicId().notNull(),
    userId: integer({ mode: 'number' }).notNull(),
    toolName: text().notNull(),
    definitionHash: text().notNull(),
    serverReadOnly: integer({ mode: 'boolean' }).notNull(),
    enabled: integer({ mode: 'boolean' }).notNull(),
    approval: text({ enum: CONNECTOR_TOOL_APPROVALS }).notNull(),
    approvedDefinitionHash: text(),
  },
  table => [
    uniqueIndex('uq_connector_tool_settings_connector_tool')
      .on(table.connectorId, table.toolName),
    index('idx_connector_tool_settings_user').on(table.userId),
  ],
)

export const connectorChatSettings = snakeCase.table(
  'connector_chat_settings',
  {
    ...defaultSchemaWithPublicId,
    userId: integer({ mode: 'number' }).notNull(),
    chatPublicId: publicId().notNull(),
    connectorId: publicId().notNull(),
    enabled: integer({ mode: 'boolean' }).notNull(),
    alwaysAllowTools: text({ mode: 'json' })
      .$type<Record<string, string>>()
      .notNull(),
  },
  table => [
    uniqueIndex('uq_connector_chat_settings_chat_connector')
      .on(table.chatPublicId, table.connectorId),
    index('idx_connector_chat_settings_user').on(table.userId),
    index('idx_connector_chat_settings_connector').on(table.connectorId),
  ],
)

export const connectorToolCalls = snakeCase.table(
  'connector_tool_calls',
  {
    ...defaultSchemaIdOnly,
    userId: integer({ mode: 'number' }).notNull(),
    connectorId: publicId().notNull(),
    connectorHost: text().notNull(),
    chatPublicId: publicId(),
    toolName: text().notNull(),
    argsHmac: text().notNull(),
    resultBytes: integer({ mode: 'number' }).notNull(),
    outcome: text({ enum: CONNECTOR_AUDIT_OUTCOMES }).notNull(),
    approval: text({ enum: CONNECTOR_AUDIT_APPROVALS }).notNull(),
    path: text({ enum: CONNECTOR_AUDIT_PATHS }).notNull(),
    durationMs: integer({ mode: 'number' }).notNull(),
    ...defaultSchemaCreatedAtOnly,
  },
  table => [
    index('idx_connector_tool_calls_user_created')
      .on(table.userId, table.createdAt),
    index('idx_connector_tool_calls_created').on(table.createdAt),
  ],
)

export const mcpRegistryServers = snakeCase.table(
  'mcp_registry_servers',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    title: text(),
    description: text().notNull(),
    remoteUrl: text().notNull(),
    remoteType: text({ enum: CONNECTOR_REGISTRY_REMOTE_TYPES }).notNull(),
    headerNames: text({ mode: 'json' }).$type<string[]>().notNull(),
    status: text().notNull(),
    registryUpdatedAt: integer({ mode: 'timestamp' }).notNull(),
    syncedAt: integer({ mode: 'timestamp' }).notNull(),
  },
  table => [
    index('idx_mcp_registry_servers_name').on(table.name),
  ],
)
