import {
  and, asc, desc, eq, getTableColumns,
} from 'drizzle-orm'
import { createError } from 'evlog'
import {
  allocateConnectorSlug,
} from '#shared/utils/connectors-slug'
import {
  CONNECTOR_TITLE_MAX_LENGTH,
} from '#shared/utils/connectors-policy'
import type {
  ConnectorAuditApproval,
  ConnectorAuditOutcome,
  ConnectorAuditPath,
  ConnectorCreatedVia,
  ConnectorRegistrationKind,
  ConnectorToolApproval,
  ConnectorTransport,
} from '#shared/utils/connectors-policy'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { isUniqueViolation } from '~~/server/utils/skills/unique-violation'

type DbClient = ReturnType<typeof useDb>

const SLUG_ALLOCATION_ATTEMPTS = 5

const {
  urlEncrypted: _urlEncrypted,
  ...connectorPublicColumns
} = getTableColumns(schema.connectors)

export type ConnectorRecord = Omit<
  typeof schema.connectors.$inferSelect,
  'urlEncrypted'
>

export type ConnectorPatch = Partial<Pick<
  typeof schema.connectors.$inferInsert,
  | 'title'
  | 'authType'
  | 'status'
  | 'enabled'
  | 'consentOrigin'
  | 'consentIssuer'
  | 'consentVersion'
  | 'consentedAt'
  | 'consentWithdrawnAt'
  | 'nativeOptInAt'
  | 'lastError'
  | 'lastConnectedAt'
>>

export interface CreateConnectorInput {
  userId: number
  title: string
  origin: string
  url: string
  slugBase: string
  createdVia: ConnectorCreatedVia
  presetId?: string | null
  createdByClientId?: string | null
  transport?: ConnectorTransport
}

export interface ConnectorClientRegistration {
  clientId: string
  registrationKind: ConnectorRegistrationKind
  clientSecret?: string
}

export interface SaveConnectorCredentialsInput {
  userId: number
  connectorId: string
  issuer: string
  clientRegistration?: ConnectorClientRegistration | null
  accessToken?: string | null
  refreshToken?: string | null
  headerName?: string | null
  headerValue?: string | null
  scope?: string | null
  expiresAt?: Date | null
}

export interface ConnectorCredentials {
  connectorId: string
  issuer: string
  clientRegistration: ConnectorClientRegistration | null
  accessToken: string | null
  refreshToken: string | null
  headerName: string | null
  headerValue: string | null
  scope: string | null
  expiresAt: Date | null
  updatedAt: Date
}

export interface ConnectorToolSettingInput {
  toolName: string
  definitionHash: string
  serverReadOnly: boolean
  enabled: boolean
  approval: ConnectorToolApproval
  approvedDefinitionHash?: string | null
}

export interface ConnectorChatSettingInput {
  userId: number
  chatPublicId: string
  connectorId: string
  enabled: boolean
  alwaysAllowTools: Record<string, string>
}

export interface ConnectorToolCallInput {
  userId: number
  connectorId: string
  connectorHost: string
  chatPublicId?: string | null
  toolName: string
  argsHmac: string
  resultBytes: number
  outcome: ConnectorAuditOutcome
  approval: ConnectorAuditApproval
  path: ConnectorAuditPath
  durationMs: number
}

export interface DeleteConnectorResult {
  connectorDeleted: boolean
  credentialsDeleted: number
  toolSettingsDeleted: number
  chatSettingsDeleted: number
}

function normalizeTitle(title: string): string {
  return title.trim().slice(0, CONNECTOR_TITLE_MAX_LENGTH)
}

async function encryptOptional(
  value: string | null | undefined,
): Promise<string | null> {
  if (value === null || value === undefined || value === '') {
    return null
  }

  return await useEncryptText(value)
}

async function decryptOptional(
  value: string | null,
): Promise<string | null> {
  if (value === null) {
    return null
  }

  return await useDecryptText(value)
}

async function listTakenSlugs(
  db: DbClient,
  userId: number,
): Promise<Set<string>> {
  const rows = await db.select({ slug: schema.connectors.slug })
    .from(schema.connectors)
    .where(eq(schema.connectors.userId, userId))

  return new Set(rows.map((row) => {
    return row.slug
  }))
}

/**
 * Inserts a disabled connector in `needs-auth`: defaults live here, not in
 * SQL. The slug is the base, or the base with `-2`, `-3`, and is retried when
 * a concurrent insert takes the same one. The URL is stored encrypted, the
 * origin in the clear.
 */
export async function createConnector(
  db: DbClient,
  input: CreateConnectorInput,
): Promise<ConnectorRecord> {
  const urlEncrypted = await useEncryptText(input.url)

  for (let attempt = 0; attempt < SLUG_ALLOCATION_ATTEMPTS; attempt++) {
    const slug = allocateConnectorSlug(
      input.slugBase,
      await listTakenSlugs(db, input.userId),
    )

    try {
      const [created] = await db.insert(schema.connectors).values({
        userId: input.userId,
        slug,
        title: normalizeTitle(input.title),
        origin: input.origin,
        urlEncrypted,
        transport: input.transport ?? 'streamable-http',
        authType: null,
        status: 'needs-auth',
        enabled: false,
        presetId: input.presetId ?? null,
        createdVia: input.createdVia,
        createdByClientId: input.createdByClientId ?? null,
      }).returning(connectorPublicColumns)

      return created!
    } catch (exception) {
      if (!isUniqueViolation(exception)) {
        throw exception
      }
    }
  }

  throw createError({
    message: 'Could not create the connector',
    status: 409,
    why: 'Another connector took the same name at the same time',
    fix: 'Try again',
  })
}

export async function listConnectors(
  db: DbClient,
  userId: number,
): Promise<ConnectorRecord[]> {
  return await db.select(connectorPublicColumns)
    .from(schema.connectors)
    .where(eq(schema.connectors.userId, userId))
    .orderBy(desc(schema.connectors.updatedAt))
}

export async function getConnector(
  db: DbClient,
  userId: number,
  connectorId: string,
): Promise<ConnectorRecord | null> {
  const [connector] = await db.select(connectorPublicColumns)
    .from(schema.connectors)
    .where(and(
      eq(schema.connectors.userId, userId),
      eq(schema.connectors.id, connectorId),
    ))
    .limit(1)

  return connector ?? null
}

/**
 * The only reader of the full URL, which can carry secrets in its path or
 * query. Never log or return the result.
 */
export async function readConnectorUrl(
  db: DbClient,
  userId: number,
  connectorId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ urlEncrypted: schema.connectors.urlEncrypted })
    .from(schema.connectors)
    .where(and(
      eq(schema.connectors.userId, userId),
      eq(schema.connectors.id, connectorId),
    ))
    .limit(1)

  if (!row) {
    return null
  }

  return await useDecryptText(row.urlEncrypted)
}

export async function updateConnector(
  db: DbClient,
  userId: number,
  connectorId: string,
  patch: ConnectorPatch,
): Promise<ConnectorRecord | null> {
  const values = patch.title === undefined
    ? patch
    : { ...patch, title: normalizeTitle(patch.title) }
  const [updated] = await db.update(schema.connectors)
    .set(values)
    .where(and(
      eq(schema.connectors.userId, userId),
      eq(schema.connectors.id, connectorId),
    ))
    .returning(connectorPublicColumns)

  return updated ?? null
}

/**
 * Deletes a connector with its credentials, tool settings and per-chat
 * settings. Audit rows stay until their retention ends. Nothing cascades, so
 * the four deletes run in one batch, the connector row last.
 */
export async function deleteConnector(
  db: DbClient,
  userId: number,
  connectorId: string,
  logger?: LoggerLike,
): Promise<DeleteConnectorResult> {
  const existing = await getConnector(db, userId, connectorId)

  if (!existing) {
    return {
      connectorDeleted: false,
      credentialsDeleted: 0,
      toolSettingsDeleted: 0,
      chatSettingsDeleted: 0,
    }
  }

  const [credentials, toolSettings, chatSettings, connectors] = await db.batch([
    db.delete(schema.connectorCredentials)
      .where(and(
        eq(schema.connectorCredentials.userId, userId),
        eq(schema.connectorCredentials.connectorId, connectorId),
      ))
      .returning({ id: schema.connectorCredentials.id }),
    db.delete(schema.connectorToolSettings)
      .where(and(
        eq(schema.connectorToolSettings.userId, userId),
        eq(schema.connectorToolSettings.connectorId, connectorId),
      ))
      .returning({ id: schema.connectorToolSettings.id }),
    db.delete(schema.connectorChatSettings)
      .where(and(
        eq(schema.connectorChatSettings.userId, userId),
        eq(schema.connectorChatSettings.connectorId, connectorId),
      ))
      .returning({ id: schema.connectorChatSettings.id }),
    db.delete(schema.connectors)
      .where(and(
        eq(schema.connectors.userId, userId),
        eq(schema.connectors.id, connectorId),
      ))
      .returning({ id: schema.connectors.id }),
  ])

  const result: DeleteConnectorResult = {
    connectorDeleted: connectors.length > 0,
    credentialsDeleted: credentials.length,
    toolSettingsDeleted: toolSettings.length,
    chatSettingsDeleted: chatSettings.length,
  }

  logger?.set({
    attributes: {
      connectors: { cleanup: { connectorDelete: { connectorId, ...result } } },
    },
  })

  return result
}

/**
 * Upserts the credentials of a connector for one issuer (empty string for
 * header auth). Every secret column is encrypted before it reaches D1.
 */
export async function saveConnectorCredentials(
  db: DbClient,
  input: SaveConnectorCredentialsInput,
): Promise<void> {
  const clientRegistration = input.clientRegistration
    ? await useEncryptText(JSON.stringify(input.clientRegistration))
    : null
  const values = {
    userId: input.userId,
    connectorId: input.connectorId,
    issuer: input.issuer,
    clientRegistration,
    accessToken: await encryptOptional(input.accessToken),
    refreshToken: await encryptOptional(input.refreshToken),
    headerName: input.headerName ?? null,
    headerValue: await encryptOptional(input.headerValue),
    scope: input.scope ?? null,
    expiresAt: input.expiresAt ?? null,
  }

  await db.insert(schema.connectorCredentials)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.connectorCredentials.connectorId,
        schema.connectorCredentials.issuer,
      ],
      set: { ...values, updatedAt: new Date() },
    })
}

export async function readConnectorCredentials(
  db: DbClient,
  userId: number,
  connectorId: string,
): Promise<ConnectorCredentials | null> {
  const [row] = await db.select()
    .from(schema.connectorCredentials)
    .where(and(
      eq(schema.connectorCredentials.userId, userId),
      eq(schema.connectorCredentials.connectorId, connectorId),
    ))
    .orderBy(desc(schema.connectorCredentials.updatedAt))
    .limit(1)

  if (!row) {
    return null
  }

  const registrationJson = await decryptOptional(row.clientRegistration)

  return {
    connectorId: row.connectorId,
    issuer: row.issuer,
    clientRegistration: registrationJson
      ? JSON.parse(registrationJson) as ConnectorClientRegistration
      : null,
    accessToken: await decryptOptional(row.accessToken),
    refreshToken: await decryptOptional(row.refreshToken),
    headerName: row.headerName,
    headerValue: await decryptOptional(row.headerValue),
    scope: row.scope,
    expiresAt: row.expiresAt,
    updatedAt: row.updatedAt,
  }
}

export async function deleteConnectorCredentials(
  db: DbClient,
  userId: number,
  connectorId: string,
): Promise<number> {
  const rows = await db.delete(schema.connectorCredentials)
    .where(and(
      eq(schema.connectorCredentials.userId, userId),
      eq(schema.connectorCredentials.connectorId, connectorId),
    ))
    .returning({ id: schema.connectorCredentials.id })

  return rows.length
}

export async function upsertConnectorToolSettings(
  db: DbClient,
  userId: number,
  connectorId: string,
  tools: ConnectorToolSettingInput[],
): Promise<void> {
  if (tools.length === 0) {
    return
  }

  const [first, ...rest] = tools.map((tool) => {
    const values = {
      userId,
      connectorId,
      toolName: tool.toolName,
      definitionHash: tool.definitionHash,
      serverReadOnly: tool.serverReadOnly,
      enabled: tool.enabled,
      approval: tool.approval,
      approvedDefinitionHash: tool.approvedDefinitionHash ?? null,
    }

    return db.insert(schema.connectorToolSettings)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.connectorToolSettings.connectorId,
          schema.connectorToolSettings.toolName,
        ],
        set: { ...values, updatedAt: new Date() },
      })
  })

  await db.batch([first!, ...rest])
}

export async function listConnectorToolSettings(
  db: DbClient,
  userId: number,
  connectorId: string,
) {
  return await db.select()
    .from(schema.connectorToolSettings)
    .where(and(
      eq(schema.connectorToolSettings.userId, userId),
      eq(schema.connectorToolSettings.connectorId, connectorId),
    ))
    .orderBy(asc(schema.connectorToolSettings.toolName))
}

export async function upsertConnectorChatSettings(
  db: DbClient,
  input: ConnectorChatSettingInput,
): Promise<void> {
  await db.insert(schema.connectorChatSettings)
    .values(input)
    .onConflictDoUpdate({
      target: [
        schema.connectorChatSettings.chatPublicId,
        schema.connectorChatSettings.connectorId,
      ],
      set: {
        enabled: input.enabled,
        alwaysAllowTools: input.alwaysAllowTools,
        updatedAt: new Date(),
      },
    })
}

export async function listConnectorChatSettings(
  db: DbClient,
  userId: number,
  chatPublicId: string,
) {
  return await db.select()
    .from(schema.connectorChatSettings)
    .where(and(
      eq(schema.connectorChatSettings.userId, userId),
      eq(schema.connectorChatSettings.chatPublicId, chatPublicId),
    ))
}

export async function recordConnectorToolCall(
  db: DbClient,
  input: ConnectorToolCallInput,
): Promise<number> {
  const { chatPublicId, ...values } = input
  const [row] = await db.insert(schema.connectorToolCalls)
    .values(chatPublicId ? { ...values, chatPublicId } : values)
    .returning({ id: schema.connectorToolCalls.id })

  return row!.id
}

export async function settleConnectorToolCall(
  db: DbClient,
  userId: number,
  callId: number,
  settlement: Pick<
    ConnectorToolCallInput,
    'outcome' | 'approval' | 'resultBytes' | 'durationMs'
  >,
): Promise<void> {
  await db.update(schema.connectorToolCalls)
    .set(settlement)
    .where(and(
      eq(schema.connectorToolCalls.userId, userId),
      eq(schema.connectorToolCalls.id, callId),
    ))
}
