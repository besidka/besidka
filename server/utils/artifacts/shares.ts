import type {
  ArtifactShareCreatedVia,
  ArtifactShareStatus,
  ArtifactShareSummary,
} from '#shared/utils/artifacts'
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import {
  ARTIFACT_SHARE_LIMIT_CODE,
  ARTIFACT_SHARE_MAX_ACTIVE,
  ARTIFACT_SHARE_PATH_PREFIX,
  ARTIFACT_SHARE_RECENT_DAYS,
} from '#shared/utils/artifacts'
import * as schema from '~~/server/db/schema'
import {
  ARTIFACT_ERROR_CODES,
  ARTIFACT_ID_CHUNK_SIZE,
  assertNotTakenDown,
  createArtifactNotFoundError,
  decodeArtifactId,
  findOwnedArtifact,
} from '~~/server/utils/artifacts/store'
import { decodePublicId, encodePublicId } from '~~/server/utils/custom-db-types'
import { useDecryptText, useEncryptText } from '~~/server/utils/encryption'

type DbClient = ReturnType<typeof useDb>

export type ArtifactShareRow = typeof schema.artifactShares.$inferSelect
export type ArtifactRow = typeof schema.artifacts.$inferSelect

export const ARTIFACT_SHARE_ID_PREFIX = 'sh_'
export const ARTIFACT_SHARE_TOKEN_BYTES = 32
export const ARTIFACT_SHARE_TOKEN_PATTERN = /^[\w-]{43}$/

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const NEVER_ENDS_SECONDS = 253402300799

export interface CreateArtifactShareInput {
  db: DbClient
  userId: number
  artifactId: string
  expiresAt: Date | null
  pinnedVersion: number | null
  storageAllowed: boolean
  bridgeAllowed: boolean
  createdVia: ArtifactShareCreatedVia
  clientId?: string | null
  now?: Date
  baseUrl?: string
}

export interface CreatedArtifactShare {
  share: ArtifactShareSummary
  token: string
  url: string
}

export interface RevokeArtifactSharesResult {
  revoked: number
  notFound: string[]
}

export type ResolvedArtifactShare
  = | {
    status: 'active'
    share: ArtifactShareRow
    artifact: ArtifactRow
    version: number
  }
  | {
    status: 'taken-down'
    share: ArtifactShareRow
    artifact: ArtifactRow
  }

/**
 * Public share ids carry a prefix outside the Hashids alphabet, so a share
 * id can never be mistaken for an artifact id with the same integer.
 */
export function encodeArtifactShareId(id: number): string {
  return `${ARTIFACT_SHARE_ID_PREFIX}${encodePublicId(id)}`
}

export function decodeArtifactShareId(publicId: string): number | null {
  if (
    typeof publicId !== 'string'
    || !publicId.startsWith(ARTIFACT_SHARE_ID_PREFIX)
  ) {
    return null
  }

  const encoded = publicId.slice(ARTIFACT_SHARE_ID_PREFIX.length)

  try {
    const id = decodePublicId(encoded)

    if (!Number.isSafeInteger(id) || id <= 0) {
      return null
    }

    return encodePublicId(id) === encoded ? id : null
  } catch {
    return null
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function generateArtifactShareToken(): string {
  const bytes = new Uint8Array(ARTIFACT_SHARE_TOKEN_BYTES)

  crypto.getRandomValues(bytes)

  return toBase64Url(bytes)
}

export function isArtifactShareToken(value: unknown): boolean {
  return typeof value === 'string' && ARTIFACT_SHARE_TOKEN_PATTERN.test(value)
}

export async function hashArtifactShareToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )

  return Array.from(new Uint8Array(digest), (byte) => {
    return byte.toString(16).padStart(2, '0')
  }).join('')
}

export function resolveArtifactShareBaseUrl(baseUrl?: string): string {
  const value = baseUrl ?? String(useRuntimeConfig().public.baseUrl ?? '')

  return value.replace(/\/$/, '')
}

export function buildArtifactShareUrl(token: string, baseUrl?: string): string {
  return `${resolveArtifactShareBaseUrl(baseUrl)}${ARTIFACT_SHARE_PATH_PREFIX}${token}`
}

/**
 * Pulls the token out of a full `/a/<token>` link (any host) or accepts a
 * bare token. Returns null for anything else.
 */
export function extractArtifactShareToken(value: string): string | null {
  const candidate = value.trim()

  if (isArtifactShareToken(candidate)) {
    return candidate
  }

  let pathname: string

  try {
    pathname = new URL(candidate).pathname
  } catch {
    pathname = candidate.split(/[?#]/)[0] ?? ''
  }

  const token = pathname.match(/^\/a\/([^/]+)\/?$/)?.[1]

  return token && isArtifactShareToken(token) ? token : null
}

/**
 * Matches the share rows that are live: not revoked, not taken down at the
 * share level and not past their expiry. An artifact-level takedown is
 * checked separately, on the artifact row.
 */
export function buildActiveArtifactShareFilter(now: Date = new Date()) {
  return and(
    isNull(schema.artifactShares.revokedAt),
    isNull(schema.artifactShares.takedownAt),
    or(
      isNull(schema.artifactShares.expiresAt),
      gt(schema.artifactShares.expiresAt, now),
    ),
  )
}

function shareEndedAtSql() {
  const shares = schema.artifactShares

  return sql<number>`min(
    coalesce(${shares.revokedAt}, ${NEVER_ENDS_SECONDS}),
    coalesce(${shares.takedownAt}, ${NEVER_ENDS_SECONDS}),
    coalesce(${shares.expiresAt}, ${NEVER_ENDS_SECONDS})
  )`
}

export function resolveArtifactShareStatus(
  share: Pick<ArtifactShareRow, 'revokedAt' | 'takedownAt' | 'expiresAt'>,
  now: Date,
  artifactTakedownAt: Date | null = null,
): ArtifactShareStatus {
  if (share.takedownAt || artifactTakedownAt) {
    return 'taken-down'
  }

  if (share.revokedAt) {
    return 'revoked'
  }

  if (share.expiresAt && share.expiresAt <= now) {
    return 'expired'
  }

  return 'active'
}

function createShareInvalidInputError(why: string, fix?: string) {
  return createError({
    message: 'Invalid share link settings',
    status: 400,
    code: ARTIFACT_ERROR_CODES.invalidInput,
    why,
    fix,
  })
}

function assertPinnedVersion(
  pinnedVersion: number | null,
  currentVersion: number,
): void {
  if (pinnedVersion === null) {
    return
  }

  if (
    !Number.isSafeInteger(pinnedVersion)
    || pinnedVersion < 1
    || pinnedVersion > currentVersion
  ) {
    throw createShareInvalidInputError(
      `Version ${pinnedVersion} does not exist; the latest is `
      + `${currentVersion}`,
      'Pin an existing version or always show the latest one',
    )
  }
}

export async function countActiveArtifactShares(input: {
  db: DbClient
  artifactInternalId: number
  now?: Date
}): Promise<number> {
  const [row] = await input.db
    .select({ total: sql<number>`count(*)` })
    .from(schema.artifactShares)
    .where(and(
      eq(schema.artifactShares.artifactId, input.artifactInternalId),
      buildActiveArtifactShareFilter(input.now),
    ))

  return Number(row?.total ?? 0)
}

function toIso(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

async function toShareSummary(input: {
  share: ArtifactShareRow
  clientName: string | null
  artifactTakedownAt: Date | null
  now: Date
  baseUrl: string
  token?: string
}): Promise<ArtifactShareSummary> {
  const status = resolveArtifactShareStatus(
    input.share,
    input.now,
    input.artifactTakedownAt,
  )
  const token = status === 'active'
    ? input.token ?? await decryptShareToken(input.share.tokenEncrypted)
    : null

  return {
    shareId: encodeArtifactShareId(input.share.id),
    url: token ? buildArtifactShareUrl(token, input.baseUrl) : null,
    createdVia: input.share.createdVia,
    clientName: input.clientName,
    pinnedVersion: input.share.pinnedVersion,
    expiresAt: toIso(input.share.expiresAt),
    revokedAt: toIso(input.share.revokedAt),
    takedownAt: toIso(input.share.takedownAt ?? input.artifactTakedownAt),
    storageAllowed: input.share.storageAllowed,
    bridgeAllowed: input.share.bridgeAllowed,
    createdAt: input.share.createdAt.toISOString(),
    status,
  }
}

async function decryptShareToken(encrypted: string): Promise<string | null> {
  try {
    return await useDecryptText(encrypted)
  } catch {
    return null
  }
}

async function findOwnedArtifactOrThrow(
  db: DbClient,
  userId: number,
  artifactId: string,
): Promise<ArtifactRow> {
  const internalId = decodeArtifactId(artifactId)

  if (internalId === null) {
    throw createArtifactNotFoundError()
  }

  const artifact = await findOwnedArtifact(db, userId, internalId)

  if (!artifact) {
    throw createArtifactNotFoundError()
  }

  return artifact
}

/**
 * Creates a public link to an owned artifact: 32 random bytes as a base64url
 * token, looked up by its sha256 (`tokenHash`) and kept encrypted
 * (`tokenEncrypted`) only so the owner can copy the link again. Refuses a
 * taken-down artifact (451), a version that does not exist (400) and an
 * eleventh active link (409 `artifact_share_limit`). The cap is
 * read-then-write, so two concurrent creates can overshoot it by one.
 * The token is returned to the caller and must never be logged.
 */
export async function createArtifactShare(
  input: CreateArtifactShareInput,
): Promise<CreatedArtifactShare> {
  const now = input.now ?? new Date()
  const artifact = await findOwnedArtifactOrThrow(
    input.db,
    input.userId,
    input.artifactId,
  )

  assertNotTakenDown(artifact)
  assertPinnedVersion(input.pinnedVersion, artifact.currentVersion)

  const activeCount = await countActiveArtifactShares({
    db: input.db,
    artifactInternalId: artifact.id,
    now,
  })

  if (activeCount >= ARTIFACT_SHARE_MAX_ACTIVE) {
    throw createError({
      message: `This artifact already has ${ARTIFACT_SHARE_MAX_ACTIVE} `
        + 'active links',
      status: 409,
      code: ARTIFACT_SHARE_LIMIT_CODE,
      why: `An artifact can have at most ${ARTIFACT_SHARE_MAX_ACTIVE} `
        + 'active share links at a time',
      fix: 'Revoke a link you no longer need, then create a new one',
    })
  }

  const token = generateArtifactShareToken()
  const [share] = await input.db
    .insert(schema.artifactShares)
    .values({
      artifactId: artifact.id,
      userId: input.userId,
      tokenHash: await hashArtifactShareToken(token),
      tokenEncrypted: await useEncryptText(token),
      createdVia: input.createdVia,
      clientId: input.clientId ?? null,
      pinnedVersion: input.pinnedVersion,
      expiresAt: input.expiresAt,
      storageAllowed: input.storageAllowed,
      bridgeAllowed: input.bridgeAllowed,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  if (!share) {
    throw createError({
      message: 'Failed to create the share link',
      status: 500,
      code: ARTIFACT_ERROR_CODES.writeFailed,
    })
  }

  const baseUrl = resolveArtifactShareBaseUrl(input.baseUrl)
  const clientName = await findOAuthClientName(input.db, share.clientId)

  return {
    share: await toShareSummary({
      share,
      clientName,
      artifactTakedownAt: artifact.takedownAt,
      now,
      baseUrl,
      token,
    }),
    token,
    url: buildArtifactShareUrl(token, baseUrl),
  }
}

async function findOAuthClientName(
  db: DbClient,
  clientId: string | null,
): Promise<string | null> {
  if (!clientId) {
    return null
  }

  const [client] = await db
    .select({ name: schema.oauthClients.name })
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.clientId, clientId))
    .limit(1)

  return client?.name ?? null
}

/**
 * Lists the links of an owned artifact: active ones first, then, with
 * `includeEnded`, links that ended (revoked, expired or taken down) in the
 * last 30 days, newest first. Active links carry the decrypted URL; ended
 * ones never do. MCP-created links name their OAuth client.
 */
export async function listArtifactShares(input: {
  db: DbClient
  userId: number
  artifactId: string
  includeEnded: boolean
  now?: Date
  baseUrl?: string
}): Promise<ArtifactShareSummary[]> {
  const now = input.now ?? new Date()
  const artifact = await findOwnedArtifactOrThrow(
    input.db,
    input.userId,
    input.artifactId,
  )
  const cutoffSeconds = Math.floor(
    (now.getTime() - ARTIFACT_SHARE_RECENT_DAYS * DAY_MILLISECONDS) / 1000,
  )
  const visible = input.includeEnded
    ? sql`${shareEndedAtSql()} >= ${cutoffSeconds}`
    : buildActiveArtifactShareFilter(now)
  const rows = await input.db
    .select({
      share: schema.artifactShares,
      clientName: schema.oauthClients.name,
    })
    .from(schema.artifactShares)
    .leftJoin(
      schema.oauthClients,
      eq(schema.oauthClients.clientId, schema.artifactShares.clientId),
    )
    .where(and(
      eq(schema.artifactShares.artifactId, artifact.id),
      eq(schema.artifactShares.userId, input.userId),
      visible,
    ))
    .orderBy(
      desc(schema.artifactShares.createdAt),
      desc(schema.artifactShares.id),
    )
  const baseUrl = resolveArtifactShareBaseUrl(input.baseUrl)
  const summaries: ArtifactShareSummary[] = []

  for (const row of rows) {
    summaries.push(await toShareSummary({
      share: row.share,
      clientName: row.clientName ?? null,
      artifactTakedownAt: artifact.takedownAt,
      now,
      baseUrl,
    }))
  }

  return summaries.sort((left, right) => {
    return Number(right.status === 'active') - Number(left.status === 'active')
  })
}

function chunk<T>(items: T[]): T[][] {
  const chunks: T[][] = []

  const size = ARTIFACT_ID_CHUNK_SIZE

  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size))
  }

  return chunks
}

function ownedArtifactIdsSubquery(db: DbClient, userId: number) {
  return db.select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .where(eq(schema.artifacts.userId, userId))
}

async function revokeByShareIds(
  db: DbClient,
  userId: number,
  shareIds: string[],
  now: Date,
): Promise<RevokeArtifactSharesResult> {
  const notFound: string[] = []
  const decoded = new Map<number, string>()

  for (const shareId of shareIds) {
    const internalId = decodeArtifactShareId(shareId)

    if (internalId === null) {
      notFound.push(shareId)
    } else {
      decoded.set(internalId, shareId)
    }
  }

  let revoked = 0

  for (const ids of chunk([...decoded.keys()])) {
    const owned = await db
      .select({ id: schema.artifactShares.id })
      .from(schema.artifactShares)
      .where(and(
        inArray(schema.artifactShares.id, ids),
        inArray(
          schema.artifactShares.artifactId,
          ownedArtifactIdsSubquery(db, userId),
        ),
      ))
    const ownedIds = new Set(owned.map((row) => {
      return row.id
    }))

    for (const id of ids) {
      if (!ownedIds.has(id)) {
        notFound.push(decoded.get(id)!)
      }
    }

    if (ownedIds.size === 0) {
      continue
    }

    const updated = await db.update(schema.artifactShares)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(
        inArray(schema.artifactShares.id, [...ownedIds]),
        isNull(schema.artifactShares.revokedAt),
      ))
      .returning({ id: schema.artifactShares.id })

    revoked += updated.length
  }

  return { revoked, notFound }
}

async function revokeByArtifactIds(
  db: DbClient,
  userId: number,
  artifactIds: string[],
  now: Date,
): Promise<RevokeArtifactSharesResult> {
  const notFound: string[] = []
  const decoded = new Map<number, string>()

  for (const artifactId of artifactIds) {
    const internalId = decodeArtifactId(artifactId)

    if (internalId === null) {
      notFound.push(artifactId)
    } else {
      decoded.set(internalId, artifactId)
    }
  }

  let revoked = 0

  for (const ids of chunk([...decoded.keys()])) {
    const owned = await db
      .select({ id: schema.artifacts.id })
      .from(schema.artifacts)
      .where(and(
        eq(schema.artifacts.userId, userId),
        inArray(schema.artifacts.id, ids),
      ))
    const ownedIds = new Set(owned.map((row) => {
      return row.id
    }))

    for (const id of ids) {
      if (!ownedIds.has(id)) {
        notFound.push(decoded.get(id)!)
      }
    }

    if (ownedIds.size === 0) {
      continue
    }

    const updated = await db.update(schema.artifactShares)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(
        inArray(schema.artifactShares.artifactId, [...ownedIds]),
        isNull(schema.artifactShares.revokedAt),
      ))
      .returning({ id: schema.artifactShares.id })

    revoked += updated.length
  }

  return { revoked, notFound }
}

/**
 * Soft-revokes links: sets `revokedAt` and never deletes the row, because
 * viewer saved-progress retention (30 days after the last link ended) and
 * the takedown record depend on it. Pass `shareIds` (public share ids) or
 * `artifactIds` (every link of those artifacts). Ownership is checked by a
 * subquery on `artifacts`, so foreign and unknown ids land in `notFound`
 * and are never touched. Already revoked links count as found but not as
 * revoked.
 */
export async function revokeArtifactShares(input: {
  db: DbClient
  userId: number
  shareIds?: string[]
  artifactIds?: string[]
  now?: Date
}): Promise<RevokeArtifactSharesResult> {
  const now = input.now ?? new Date()
  const byShare = await revokeByShareIds(
    input.db,
    input.userId,
    [...new Set(input.shareIds ?? [])],
    now,
  )
  const byArtifact = await revokeByArtifactIds(
    input.db,
    input.userId,
    [...new Set(input.artifactIds ?? [])],
    now,
  )

  return {
    revoked: byShare.revoked + byArtifact.revoked,
    notFound: [...byShare.notFound, ...byArtifact.notFound],
  }
}

export async function findArtifactShareByToken(input: {
  db: DbClient
  token: string
}): Promise<{ share: ArtifactShareRow, artifact: ArtifactRow } | null> {
  if (!isArtifactShareToken(input.token)) {
    return null
  }

  const [row] = await input.db
    .select({
      share: schema.artifactShares,
      artifact: schema.artifacts,
    })
    .from(schema.artifactShares)
    .innerJoin(schema.artifacts, and(
      eq(schema.artifacts.id, schema.artifactShares.artifactId),
      eq(schema.artifacts.userId, schema.artifactShares.userId),
      gt(schema.artifacts.currentVersion, 0),
    ))
    .where(eq(
      schema.artifactShares.tokenHash,
      await hashArtifactShareToken(input.token),
    ))
    .limit(1)

  return row ?? null
}

/**
 * Resolves a public link by its token: null for an unknown, malformed,
 * revoked or expired link (callers answer 404), `taken-down` when the link
 * or its artifact was taken down (callers answer 410), otherwise the share,
 * the artifact and the version to show (the pinned one, else the current
 * one).
 */
export async function resolveActiveArtifactShare(input: {
  db: DbClient
  token: string | null | undefined
  now?: Date
}): Promise<ResolvedArtifactShare | null> {
  if (!input.token) {
    return null
  }

  const now = input.now ?? new Date()
  const row = await findArtifactShareByToken({
    db: input.db,
    token: input.token,
  })

  if (!row) {
    return null
  }

  const { share, artifact } = row

  if (share.revokedAt || (share.expiresAt && share.expiresAt <= now)) {
    return null
  }

  if (share.takedownAt || artifact.takedownAt) {
    return { status: 'taken-down', share, artifact }
  }

  const version = share.pinnedVersion ?? artifact.currentVersion

  if (version < 1 || version > artifact.currentVersion) {
    return null
  }

  return { status: 'active', share, artifact, version }
}
