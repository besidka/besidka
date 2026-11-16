import {
  and, asc, desc, eq, getTableColumns, gte, inArray, ne, sql,
} from 'drizzle-orm'
import { createError } from 'evlog'
import {
  allocateConnectorSlug,
} from '#shared/utils/connectors-slug'
import { sanitizeConnectorText } from '#shared/utils/connectors-text'
import {
  CONNECTOR_NEW_TOOL_MODE,
  CONNECTOR_TITLE_MAX_LENGTH,
  CONNECTORS_MCP_DISABLED_MAX,
  CONNECTORS_PER_USER,
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
import {
  decodePublicId,
  encodePublicId,
} from '~~/server/utils/custom-db-types'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { isUniqueViolation } from '~~/server/utils/skills/unique-violation'

type DbClient = ReturnType<typeof useDb>

const SLUG_ALLOCATION_ATTEMPTS = 5

const {
  urlEncrypted: _urlEncrypted,
  ...connectorPublicColumns
} = getTableColumns(schema.connectors)

type ConnectorRow = Omit<typeof schema.connectors.$inferSelect, 'urlEncrypted'>

export type ConnectorRecord = Omit<ConnectorRow, 'id'> & { id: string }

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
  | 'toolMode'
>>

const CONNECTOR_PATCH_KEYS = [
  'title',
  'authType',
  'status',
  'enabled',
  'consentOrigin',
  'consentIssuer',
  'consentVersion',
  'consentedAt',
  'consentWithdrawnAt',
  'nativeOptInAt',
  'lastError',
  'lastConnectedAt',
  'toolMode',
] as const satisfies ReadonlyArray<keyof ConnectorPatch>

export interface CreateConnectorInput {
  userId: number
  title: string
  url: string
  slugBase: string
  createdVia: ConnectorCreatedVia
  presetId?: string | null
  createdByClientId?: string | null
  transport?: ConnectorTransport
}

export type ConnectorTokenEndpointAuthMethod
  = | 'none'
    | 'client_secret_post'
    | 'client_secret_basic'

/**
 * What a connector needs to talk to its authorization server again after
 * the flow: the client identity, and the endpoints and resource pinned at
 * connect time, so a refresh or a revocation never rediscovers them from a
 * server that may have changed its metadata since.
 */
export interface ConnectorClientRegistration {
  clientId: string
  registrationKind: ConnectorRegistrationKind
  clientSecret?: string
  tokenEndpointAuthMethod?: ConnectorTokenEndpointAuthMethod
  redirectUri?: string
  tokenEndpoint?: string
  revocationEndpoint?: string | null
  resource?: string
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
  generation: string
}

export interface ConnectorTokenUpdate {
  userId: number
  connectorId: string
  expectedGeneration: string
  accessToken: string
  refreshToken: string | null
  scope: string | null
  expiresAt: Date | null
}

export interface ConnectorCredentialsGenerationInput {
  userId: number
  connectorId: string
  expectedGeneration: string
}

export interface UserConnectorCredentials extends ConnectorCredentials {
  connectorHost: string
}

export interface ConnectorToolSettingInput {
  toolName: string
  definitionHash: string
  serverReadOnly: boolean
  enabled: boolean
  approval: ConnectorToolApproval
  approvedDefinitionHash?: string | null
}

/**
 * Reserved `connector_tool_settings.tool_name` of the row that records "a
 * baseline was taken", so a first listing with no usable tools still counts
 * as the trust-on-first-use baseline. The empty string can never be a real
 * tool: `normalizeToolDefinitions` skips tools without a name.
 */
export const CONNECTOR_BASELINE_MARKER_TOOL_NAME = ''

export const CONNECTOR_BASELINE_MARKER_SETTING: ConnectorToolSettingInput = {
  toolName: CONNECTOR_BASELINE_MARKER_TOOL_NAME,
  definitionHash: '',
  serverReadOnly: false,
  enabled: false,
  approval: 'ask',
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

function createConnectorLimitError() {
  return createError({
    message: 'Connector limit reached',
    status: 409,
    code: 'CONNECTOR_LIMIT_REACHED',
    why: `An account can have at most ${CONNECTORS_PER_USER} connectors`,
    fix: 'Delete a connector you no longer use',
  })
}

function toConnectorRecord(row: ConnectorRow): ConnectorRecord {
  return { ...row, id: encodePublicId(row.id) }
}

/**
 * Whether a public connector id decodes to a database id. A string of the
 * right alphabet can still be a made-up id, which decodes to `NaN` and must
 * never reach a query.
 */
export function isConnectorIdDecodable(connectorId: string): boolean {
  try {
    const decoded = decodePublicId(connectorId)

    return Number.isSafeInteger(decoded) && decoded > 0
  } catch {
    return false
  }
}

function connectorIdEquals(connectorId: string) {
  return eq(schema.connectors.id, decodePublicId(connectorId))
}

function pickConnectorPatch(patch: ConnectorPatch): ConnectorPatch {
  const picked: Record<string, unknown> = {}

  for (const key of CONNECTOR_PATCH_KEYS) {
    if (Object.hasOwn(patch, key) && patch[key] !== undefined) {
      picked[key] = key === 'title'
        ? normalizeTitle(patch.title!)
        : patch[key]
    }
  }

  return picked as ConnectorPatch
}

async function assertConnectorOwned(
  db: DbClient,
  userId: number,
  connectorId: string,
): Promise<void> {
  const [owned] = await db.select({ id: schema.connectors.id })
    .from(schema.connectors)
    .where(and(
      eq(schema.connectors.userId, userId),
      connectorIdEquals(connectorId),
    ))
    .limit(1)

  if (!owned) {
    throw createError({
      message: 'Connector not found',
      status: 404,
      why: 'No connector with this id belongs to the account',
      fix: 'Check the connector id',
    })
  }
}

function normalizeTitle(title: string): string {
  return sanitizeConnectorText(title, CONNECTOR_TITLE_MAX_LENGTH)
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

function createConnectorMcpLimitError() {
  return createError({
    message: 'Too many connectors added over MCP are still switched off',
    status: 409,
    code: 'CONNECTOR_MCP_LIMIT_REACHED',
    why: `At most ${CONNECTORS_MCP_DISABLED_MAX} connectors added by `
      + 'connected apps can wait switched off',
    fix: 'Switch one on in Besidka, or delete one you do not use',
  })
}

/**
 * Throws the connector-limit error when the user is already at the cap. A
 * cheap early check for callers that do slow work (a probe) before
 * `createConnector`; the atomic cap in `createConnector` stays the guard.
 */
export async function assertConnectorCapacity(
  db: DbClient,
  userId: number,
): Promise<void> {
  const [row] = await db.select({ total: sql<number>`count(*)` })
    .from(schema.connectors)
    .where(eq(schema.connectors.userId, userId))

  if ((row?.total ?? 0) >= CONNECTORS_PER_USER) {
    throw createConnectorLimitError()
  }
}

/**
 * Inserts a disabled connector in `needs-auth`: defaults live here, not in
 * SQL. The origin is derived from the URL here, never taken from the caller.
 * The slug is the base, or the base with `-2`, `-3`, and is retried when a
 * concurrent insert takes the same one. The URL is stored encrypted, the
 * origin in the clear. The per-user cap is enforced in the same batch as the
 * insert: the row is removed again, atomically, when it would be the
 * (cap + 1)th, so two concurrent creates cannot both pass a count. A row
 * added over MCP is held to the same rule for connectors that are still
 * switched off (`CONNECTORS_MCP_DISABLED_MAX`).
 */
export async function createConnector(
  db: DbClient,
  input: CreateConnectorInput,
): Promise<ConnectorRecord> {
  const origin = new URL(input.url).origin
  const urlEncrypted = await useEncryptText(input.url)

  for (let attempt = 0; attempt < SLUG_ALLOCATION_ATTEMPTS; attempt++) {
    const slug = allocateConnectorSlug(
      input.slugBase,
      await listTakenSlugs(db, input.userId),
    )

    try {
      const [inserted, overCap, overMcpCap] = await db.batch([
        db.insert(schema.connectors).values({
          userId: input.userId,
          slug,
          title: normalizeTitle(input.title),
          origin,
          urlEncrypted,
          transport: input.transport ?? 'streamable-http',
          authType: null,
          status: 'needs-auth',
          enabled: false,
          presetId: input.presetId ?? null,
          createdVia: input.createdVia,
          createdByClientId: input.createdByClientId ?? null,
          toolMode: CONNECTOR_NEW_TOOL_MODE,
        }).returning(connectorPublicColumns),
        db.delete(schema.connectors)
          .where(and(
            sql`${schema.connectors.id} = last_insert_rowid()`,
            eq(schema.connectors.userId, input.userId),
            sql`(select count(*) from ${schema.connectors}
              where ${schema.connectors.userId} = ${input.userId})
              > ${CONNECTORS_PER_USER}`,
          ))
          .returning({ id: schema.connectors.id }),
        db.delete(schema.connectors)
          .where(and(
            sql`${schema.connectors.id} = last_insert_rowid()`,
            eq(schema.connectors.userId, input.userId),
            eq(schema.connectors.createdVia, 'mcp'),
            sql`(select count(*) from ${schema.connectors}
              where ${schema.connectors.userId} = ${input.userId}
              and ${schema.connectors.createdVia} = 'mcp'
              and ${schema.connectors.enabled} = 0)
              > ${CONNECTORS_MCP_DISABLED_MAX}`,
          ))
          .returning({ id: schema.connectors.id }),
      ])

      if (overCap.length > 0) {
        throw createConnectorLimitError()
      }

      if (overMcpCap.length > 0) {
        throw createConnectorMcpLimitError()
      }

      return toConnectorRecord(inserted[0]!)
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
  const rows = await db.select(connectorPublicColumns)
    .from(schema.connectors)
    .where(eq(schema.connectors.userId, userId))
    .orderBy(desc(schema.connectors.updatedAt))

  return rows.map(toConnectorRecord)
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
      connectorIdEquals(connectorId),
    ))
    .limit(1)

  return connector ? toConnectorRecord(connector) : null
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
      connectorIdEquals(connectorId),
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
  const values = pickConnectorPatch(patch)

  if (Object.keys(values).length === 0) {
    return await getConnector(db, userId, connectorId)
  }

  const [updated] = await db.update(schema.connectors)
    .set(values)
    .where(and(
      eq(schema.connectors.userId, userId),
      connectorIdEquals(connectorId),
    ))
    .returning(connectorPublicColumns)

  return updated ? toConnectorRecord(updated) : null
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
        connectorIdEquals(connectorId),
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
  await assertConnectorOwned(db, input.userId, input.connectorId)

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
      set: {
        clientRegistration: values.clientRegistration,
        accessToken: values.accessToken,
        refreshToken: values.refreshToken,
        headerName: values.headerName,
        headerValue: values.headerValue,
        scope: values.scope,
        expiresAt: values.expiresAt,
        updatedAt: new Date(),
      },
      setWhere: eq(schema.connectorCredentials.userId, input.userId),
    })
}

type CredentialsRow = typeof schema.connectorCredentials.$inferSelect

function credentialsGeneration(row: CredentialsRow): string {
  return row.accessToken ?? `static:${row.updatedAt.getTime()}`
}

async function toConnectorCredentials(
  row: CredentialsRow,
): Promise<ConnectorCredentials> {
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
    generation: credentialsGeneration(row),
  }
}

/**
 * The credentials of a connector. `generation` is the stored access-token
 * ciphertext (a fresh random IV on every write), the compare-and-set token
 * for refreshes: `updated_at` has one-second resolution, so two writes in
 * the same second would look the same by timestamp alone.
 */
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

  return await toConnectorCredentials(row)
}

/**
 * Every credentials row of a user with the connector host, for best-effort
 * revocation before an account purge.
 */
export async function listUserConnectorCredentials(
  db: DbClient,
  userId: number,
): Promise<UserConnectorCredentials[]> {
  const rows = await db.select()
    .from(schema.connectorCredentials)
    .where(eq(schema.connectorCredentials.userId, userId))
  const connectorRows = await db.select({
    id: schema.connectors.id,
    origin: schema.connectors.origin,
  })
    .from(schema.connectors)
    .where(eq(schema.connectors.userId, userId))
  const hostByConnectorId = new Map(connectorRows.map((connector) => {
    return [encodePublicId(connector.id), new URL(connector.origin).host]
  }))
  const credentials: UserConnectorCredentials[] = []

  for (const row of rows) {
    credentials.push({
      ...await toConnectorCredentials(row),
      connectorHost: hostByConnectorId.get(row.connectorId) ?? '',
    })
  }

  return credentials
}

/**
 * Replaces every credentials row of a connector with one row: a new sign-in
 * (or a new header) supersedes what was stored for any issuer, so a
 * connector never holds tokens from two authorization servers.
 */
export async function replaceConnectorCredentials(
  db: DbClient,
  input: SaveConnectorCredentialsInput,
): Promise<void> {
  await assertConnectorOwned(db, input.userId, input.connectorId)

  const clientRegistration = input.clientRegistration
    ? await useEncryptText(JSON.stringify(input.clientRegistration))
    : null

  await db.batch([
    db.delete(schema.connectorCredentials)
      .where(and(
        eq(schema.connectorCredentials.userId, input.userId),
        eq(schema.connectorCredentials.connectorId, input.connectorId),
      )),
    db.insert(schema.connectorCredentials).values({
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
    }),
  ])
}

/**
 * Writes refreshed tokens only while the row still holds the generation the
 * caller refreshed from. Returns false when another writer got there first;
 * the caller then re-reads instead of overwriting a newer (possibly rotated)
 * refresh token with a stale one.
 */
export async function compareAndSetConnectorTokens(
  db: DbClient,
  input: ConnectorTokenUpdate,
): Promise<boolean> {
  const rows = await db.update(schema.connectorCredentials)
    .set({
      accessToken: await useEncryptText(input.accessToken),
      refreshToken: await encryptOptional(input.refreshToken),
      scope: input.scope,
      expiresAt: input.expiresAt,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.connectorCredentials.userId, input.userId),
      eq(schema.connectorCredentials.connectorId, input.connectorId),
      eq(schema.connectorCredentials.accessToken, input.expectedGeneration),
    ))
    .returning({ id: schema.connectorCredentials.id })

  return rows.length > 0
}

/**
 * Deletes the credentials only while they are still the generation the
 * caller saw fail, so a terminal refresh error after another writer already
 * stored fresh tokens does not wipe them.
 */
export async function compareAndDeleteConnectorCredentials(
  db: DbClient,
  input: ConnectorCredentialsGenerationInput,
): Promise<boolean> {
  const rows = await db.delete(schema.connectorCredentials)
    .where(and(
      eq(schema.connectorCredentials.userId, input.userId),
      eq(schema.connectorCredentials.connectorId, input.connectorId),
      eq(schema.connectorCredentials.accessToken, input.expectedGeneration),
    ))
    .returning({ id: schema.connectorCredentials.id })

  return rows.length > 0
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

  await assertConnectorOwned(db, userId, connectorId)

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
        set: {
          definitionHash: values.definitionHash,
          serverReadOnly: values.serverReadOnly,
          enabled: values.enabled,
          approval: values.approval,
          approvedDefinitionHash: values.approvedDefinitionHash,
          updatedAt: new Date(),
        },
        setWhere: eq(schema.connectorToolSettings.userId, userId),
      })
  })

  await db.batch([first!, ...rest])
}

async function selectConnectorToolSettingRows(
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

export async function listConnectorToolSettings(
  db: DbClient,
  userId: number,
  connectorId: string,
) {
  const rows = await selectConnectorToolSettingRows(db, userId, connectorId)

  return rows.filter((row) => {
    return row.toolName !== CONNECTOR_BASELINE_MARKER_TOOL_NAME
  })
}

export interface ConnectorToolReduction {
  toolName: string
  disable: boolean
  askEveryTime: boolean
}

export interface ConnectorToolReductionResult {
  unknownTools: string[]
}

/**
 * The only tool-setting change that is safe for an external agent: turn a
 * tool off, or set it back to "ask every time" (which also drops the
 * approved definition hash, so an "Always allow" grant ends; a per-chat
 * "Allow in this chat" grant is a different row and stays). It never
 * inserts a row, never turns a tool on and never grants anything. All names
 * are checked against the connector's own tool settings first, and nothing
 * changes when one is unknown.
 */
export async function reduceConnectorToolSettings(
  db: DbClient,
  userId: number,
  connectorId: string,
  reductions: readonly ConnectorToolReduction[],
): Promise<ConnectorToolReductionResult> {
  await assertConnectorOwned(db, userId, connectorId)

  const known = new Set((await listConnectorToolSettings(
    db,
    userId,
    connectorId,
  )).map((row) => {
    return row.toolName
  }))
  const unknownTools = reductions
    .map((reduction) => {
      return reduction.toolName
    })
    .filter((toolName) => {
      return !known.has(toolName)
    })

  if (unknownTools.length > 0 || reductions.length === 0) {
    return { unknownTools }
  }

  const [first, ...rest] = reductions.map((reduction) => {
    return db.update(schema.connectorToolSettings)
      .set({
        ...(reduction.disable ? { enabled: false } : {}),
        ...(reduction.askEveryTime
          ? {
            approval: 'needs-approval' as const,
            approvedDefinitionHash: null,
          }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.connectorToolSettings.userId, userId),
        eq(schema.connectorToolSettings.connectorId, connectorId),
        eq(schema.connectorToolSettings.toolName, reduction.toolName),
        ne(
          schema.connectorToolSettings.toolName,
          CONNECTOR_BASELINE_MARKER_TOOL_NAME,
        ),
      ))
  })

  await db.batch([first!, ...rest])

  return { unknownTools: [] }
}

export interface ConnectorToolCounts {
  total: number
  enabled: number
}

export async function countConnectorToolSettings(
  db: DbClient,
  userId: number,
): Promise<Map<string, ConnectorToolCounts>> {
  const rows = await db.select({
    connectorId: schema.connectorToolSettings.connectorId,
    total: sql<number>`count(*)`,
    enabled: sql<number>`coalesce(sum(case when ${
      schema.connectorToolSettings.enabled
    } then 1 else 0 end), 0)`,
  })
    .from(schema.connectorToolSettings)
    .where(and(
      eq(schema.connectorToolSettings.userId, userId),
      ne(
        schema.connectorToolSettings.toolName,
        CONNECTOR_BASELINE_MARKER_TOOL_NAME,
      ),
    ))
    .groupBy(schema.connectorToolSettings.connectorId)

  return new Map(rows.map((row) => {
    return [
      String(row.connectorId),
      { total: Number(row.total), enabled: Number(row.enabled) },
    ]
  }))
}

export async function countConnectorToolCallsSince(
  db: DbClient,
  userId: number,
  connectorId: string,
  since: Date,
): Promise<number> {
  const [row] = await db.select({ total: sql<number>`count(*)` })
    .from(schema.connectorToolCalls)
    .where(and(
      eq(schema.connectorToolCalls.userId, userId),
      eq(schema.connectorToolCalls.connectorId, connectorId),
      gte(schema.connectorToolCalls.createdAt, since),
    ))

  return Number(row?.total ?? 0)
}

export async function readConnectorToolBaseline(
  db: DbClient,
  userId: number,
  connectorId: string,
) {
  const rows = await selectConnectorToolSettingRows(db, userId, connectorId)

  return {
    isBaselined: rows.length > 0,
    settings: rows.filter((row) => {
      return row.toolName !== CONNECTOR_BASELINE_MARKER_TOOL_NAME
    }),
  }
}

/**
 * Deletes the reviewed rows of tools the server no longer lists. The
 * baseline marker row is never deleted here.
 */
export async function deleteConnectorToolSettings(
  db: DbClient,
  userId: number,
  connectorId: string,
  toolNames: readonly string[],
): Promise<number> {
  const names = toolNames.filter((name) => {
    return name !== CONNECTOR_BASELINE_MARKER_TOOL_NAME
  })

  if (names.length === 0) {
    return 0
  }

  const rows = await db.delete(schema.connectorToolSettings)
    .where(and(
      eq(schema.connectorToolSettings.userId, userId),
      eq(schema.connectorToolSettings.connectorId, connectorId),
      inArray(schema.connectorToolSettings.toolName, names),
    ))
    .returning({ id: schema.connectorToolSettings.id })

  return rows.length
}

export interface ConnectorToolSwitch {
  toolName: string
  enabled?: boolean
  resetApproval?: boolean
  needsApproval?: boolean
  alwaysAllowHash?: string
}

/**
 * Turns reviewed tools on or off, sets the approval back to the default
 * (`resetApproval`, stored `ask`), to an explicit Needs approval
 * (`needsApproval`), or to Always allow (`alwaysAllowHash`, the reviewed
 * definition hash the caller checked), without touching the reviewed
 * definition hash, so a page change can never accept a changed definition.
 * An "Always allow" applies only while the stored hash equals the one it was
 * given for. Rows of other users, unknown tools and the baseline marker are
 * left alone. Returns the names that changed.
 */
function approvalOfSwitch(entry: ConnectorToolSwitch): {
  approval: ConnectorToolApproval
  approvedDefinitionHash: string | null
} | null {
  if (entry.alwaysAllowHash) {
    return { approval: 'always', approvedDefinitionHash: entry.alwaysAllowHash }
  }

  if (entry.needsApproval) {
    return { approval: 'needs-approval', approvedDefinitionHash: null }
  }

  return entry.resetApproval
    ? { approval: 'ask', approvedDefinitionHash: null }
    : null
}

export async function updateConnectorToolSwitches(
  db: DbClient,
  userId: number,
  connectorId: string,
  switches: readonly ConnectorToolSwitch[],
): Promise<string[]> {
  const statements = switches
    .filter((entry) => {
      return entry.toolName !== CONNECTOR_BASELINE_MARKER_TOOL_NAME
        && (
          entry.enabled !== undefined
          || entry.resetApproval
          || entry.needsApproval
          || entry.alwaysAllowHash
        )
    })
    .map((entry) => {
      const approval = approvalOfSwitch(entry)

      return db.update(schema.connectorToolSettings)
        .set({
          ...(entry.enabled !== undefined ? { enabled: entry.enabled } : {}),
          ...(approval ?? {}),
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.connectorToolSettings.userId, userId),
          eq(schema.connectorToolSettings.connectorId, connectorId),
          eq(schema.connectorToolSettings.toolName, entry.toolName),
          ...(entry.alwaysAllowHash
            ? [eq(
              schema.connectorToolSettings.definitionHash,
              entry.alwaysAllowHash,
            )]
            : []),
        ))
        .returning({ toolName: schema.connectorToolSettings.toolName })
    })

  if (statements.length === 0) {
    return []
  }

  const [first, ...rest] = statements
  const results = await db.batch([first!, ...rest])

  return results.flatMap((rows) => {
    return rows.map(row => row.toolName)
  })
}

export async function upsertConnectorChatSettings(
  db: DbClient,
  input: ConnectorChatSettingInput,
): Promise<void> {
  await assertConnectorOwned(db, input.userId, input.connectorId)
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
      setWhere: eq(schema.connectorChatSettings.userId, input.userId),
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
