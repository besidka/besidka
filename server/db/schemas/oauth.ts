import {
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { sessions, users } from './auth'
import {
  defaultSchema,
  defaultSchemaCreatedAtOnly,
  defaultSchemaIdOnly,
} from '../../utils/schema'

export const jwkss = snakeCase.table('jwks', {
  ...defaultSchemaIdOnly,
  publicKey: text().notNull(),
  privateKey: text().notNull(),
  createdAt: integer({ mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer({ mode: 'timestamp' }),
  alg: text(),
  crv: text(),
})

export const oauthClients = snakeCase.table(
  'oauth_clients',
  {
    ...defaultSchema,
    clientId: text().notNull().unique(),
    clientSecret: text(),
    clientDiscoveryId: text(),
    disabled: integer({ mode: 'boolean' }).$defaultFn(() => false),
    skipConsent: integer({ mode: 'boolean' }),
    enableEndSession: integer({ mode: 'boolean' }),
    subjectType: text(),
    scopes: text({ mode: 'json' }),
    clientCredentialsScopes: text({ mode: 'json' }).$defaultFn(() => []),
    userId: integer({ mode: 'number' }).references(() => users.id),
    name: text(),
    uri: text(),
    icon: text(),
    contacts: text({ mode: 'json' }),
    tos: text(),
    policy: text(),
    softwareId: text(),
    softwareVersion: text(),
    softwareStatement: text(),
    redirectUris: text({ mode: 'json' }).notNull(),
    postLogoutRedirectUris: text({ mode: 'json' }),
    backchannelLogoutUri: text(),
    backchannelLogoutSessionRequired: integer({ mode: 'boolean' }),
    tokenEndpointAuthMethod: text(),
    applicationType: text(),
    jwks: text(),
    jwksUri: text(),
    grantTypes: text({ mode: 'json' }),
    responseTypes: text({ mode: 'json' }),
    requirePKCE: integer({ mode: 'boolean' }),
    dpopBoundAccessTokens: integer({ mode: 'boolean' })
      .$defaultFn(() => false),
    referenceId: text(),
    metadata: text({ mode: 'json' }),
  },
  table => [index('idx_oauth_clients_user_id').on(table.userId)],
)

export const oauthResources = snakeCase.table('oauth_resources', {
  ...defaultSchema,
  identifier: text().notNull().unique(),
  name: text().notNull(),
  accessTokenTtl: integer({ mode: 'number' }),
  refreshTokenTtl: integer({ mode: 'number' }),
  signingAlgorithm: text(),
  signingKeyId: text(),
  allowedScopes: text({ mode: 'json' }),
  customClaims: text({ mode: 'json' }),
  dpopBoundAccessTokensRequired: integer({ mode: 'boolean' })
    .$defaultFn(() => false),
  disabled: integer({ mode: 'boolean' }).$defaultFn(() => false),
  policyVersion: integer({ mode: 'number' }).$defaultFn(() => 1),
  metadata: text({ mode: 'json' }),
})

export const oauthClientResources = snakeCase.table(
  'oauth_client_resources',
  {
    ...defaultSchemaIdOnly,
    ...defaultSchemaCreatedAtOnly,
    clientId: text()
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    resourceId: text()
      .notNull()
      .references(() => oauthResources.identifier, { onDelete: 'cascade' }),
    metadata: text({ mode: 'json' }),
  },
  table => [
    uniqueIndex('uidx_oauth_client_resources_client_id_resource_id').on(
      table.clientId,
      table.resourceId,
    ),
    index('idx_oauth_client_resources_client_id').on(table.clientId),
    index('idx_oauth_client_resources_resource_id').on(table.resourceId),
  ],
)

export const oauthRefreshTokens = snakeCase.table(
  'oauth_refresh_tokens',
  {
    ...defaultSchemaIdOnly,
    ...defaultSchemaCreatedAtOnly,
    token: text().notNull().unique(),
    clientId: text()
      .notNull()
      .references(() => oauthClients.clientId),
    sessionId: integer({ mode: 'number' })
      .references(() => sessions.id, { onDelete: 'set null' }),
    userId: integer({ mode: 'number' })
      .notNull()
      .references(() => users.id),
    referenceId: text(),
    authorizationCodeId: text(),
    resources: text({ mode: 'json' }),
    requestedUserInfoClaims: text({ mode: 'json' }),
    expiresAt: integer({ mode: 'timestamp' }).notNull(),
    revoked: integer({ mode: 'timestamp' }),
    rotatedAt: integer({ mode: 'timestamp' }),
    rotationReplayResponse: text(),
    rotationReplayExpiresAt: integer({ mode: 'timestamp' }),
    authTime: integer({ mode: 'timestamp' }),
    confirmation: text({ mode: 'json' }),
    scopes: text({ mode: 'json' }).notNull(),
  },
  table => [
    index('idx_oauth_refresh_tokens_client_id').on(table.clientId),
    index('idx_oauth_refresh_tokens_session_id').on(table.sessionId),
    index('idx_oauth_refresh_tokens_user_id').on(table.userId),
    index('idx_oauth_refresh_tokens_authorization_code_id')
      .on(table.authorizationCodeId),
  ],
)

export const oauthAccessTokens = snakeCase.table(
  'oauth_access_tokens',
  {
    ...defaultSchemaIdOnly,
    ...defaultSchemaCreatedAtOnly,
    token: text().notNull().unique(),
    clientId: text()
      .notNull()
      .references(() => oauthClients.clientId),
    sessionId: integer({ mode: 'number' })
      .references(() => sessions.id, { onDelete: 'set null' }),
    userId: integer({ mode: 'number' }).references(() => users.id),
    referenceId: text(),
    authorizationCodeId: text(),
    resources: text({ mode: 'json' }),
    requestedUserInfoClaims: text({ mode: 'json' }),
    refreshId: integer({ mode: 'number' })
      .references(() => oauthRefreshTokens.id),
    expiresAt: integer({ mode: 'timestamp' }).notNull(),
    revoked: integer({ mode: 'timestamp' }),
    confirmation: text({ mode: 'json' }),
    scopes: text({ mode: 'json' }).notNull(),
  },
  table => [
    index('idx_oauth_access_tokens_client_id').on(table.clientId),
    index('idx_oauth_access_tokens_session_id').on(table.sessionId),
    index('idx_oauth_access_tokens_user_id').on(table.userId),
    index('idx_oauth_access_tokens_authorization_code_id')
      .on(table.authorizationCodeId),
    index('idx_oauth_access_tokens_refresh_id').on(table.refreshId),
  ],
)

export const oauthConsents = snakeCase.table(
  'oauth_consents',
  {
    ...defaultSchema,
    clientId: text()
      .notNull()
      .references(() => oauthClients.clientId),
    userId: integer({ mode: 'number' }).references(() => users.id),
    referenceId: text(),
    resources: text({ mode: 'json' }),
    requestedUserInfoClaims: text({ mode: 'json' }),
    scopes: text({ mode: 'json' }).notNull(),
  },
  table => [
    index('idx_oauth_consents_client_id').on(table.clientId),
    index('idx_oauth_consents_user_id').on(table.userId),
  ],
)

export const oauthClientAssertions = snakeCase.table(
  'oauth_client_assertions',
  {
    ...defaultSchemaIdOnly,
    expiresAt: integer({ mode: 'timestamp' }).notNull(),
  },
)
