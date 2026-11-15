import type {
  AdminArtifactReportDetail,
  AdminArtifactReportSummary,
  ArtifactReportAction,
  ArtifactReportActionScope,
  ArtifactReportDecision,
  ArtifactReportStatus,
  ArtifactTakedownScope,
} from '#shared/utils/artifacts'
import type { FeatureAdminContext } from '~~/server/utils/features/admin'
import type {
  ArtifactDecisionOutcome,
  ArtifactReportLocation,
} from '~~/server/utils/artifacts/report-emails'
import type { ArtifactRow, ArtifactShareRow } from '~~/server/utils/artifacts/shares'
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { ARTIFACT_LEGAL_HOLD_MONTHS } from '#shared/utils/artifacts'
import * as schema from '~~/server/db/schema'
import {
  sendArtifactReportDecisionEmail,
  sendArtifactStatementOfReasonsEmail,
} from '~~/server/utils/artifacts/report-emails'
import {
  buildArtifactShareUrl,
  decodeArtifactShareId,
  encodeArtifactShareId,
  extractArtifactShareToken,
  findArtifactShareByToken,
  resolveArtifactShareBaseUrl,
  resolveArtifactShareStatus,
} from '~~/server/utils/artifacts/shares'
import {
  chunkIds,
  decodeArtifactId,
  encodeArtifactId,
} from '~~/server/utils/artifacts/store'
import { useDecryptText } from '~~/server/utils/encryption'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  buildAuditInsert,
  logFeatureAccess,
  throwAdminError,
  toGrantSnapshot,
} from '~~/server/utils/features/admin'

type DbClient = ReturnType<typeof useDb>
type AdminDb = FeatureAdminContext['db']

const DETAILS_PREVIEW_LENGTH = 200
const AUDIT_ID_LIST_MAX = 100
const AUDIT_FLAG = 'artifacts'
const ARTIFACT_SHARE_FLAG = 'artifacts.share'
const ARTIFACT_SHARE_DENY_REASON = 'Artifact takedown at user scope'

export interface ListArtifactReportsInput {
  db: DbClient
  status?: ArtifactReportStatus
  offset: number
  limit: number
  now?: Date
}

export interface ArtifactTakedownResult {
  scope: ArtifactTakedownScope
  takenDown: number
  alreadyTakenDown: number
  artifactIds: string[]
  shareId: string | null
  ownerUserId: number
  legalHoldUntil: string | null
}

export interface ArtifactReportDecisionResult {
  reportId: number
  status: ArtifactReportStatus
  decision: ArtifactReportDecision
  newlyTakenDown: boolean
}

export interface ArtifactRestoreResult {
  restored: true
  artifactId: string | null
  shareId: string | null
}

function reportSelection() {
  return {
    report: schema.artifactReports,
    artifactTitle: schema.artifacts.title,
    artifactKind: schema.artifacts.kind,
    artifactCurrentVersion: schema.artifacts.currentVersion,
    artifactOwnerUserId: schema.artifacts.userId,
    artifactTakedownAt: schema.artifacts.takedownAt,
    artifactLegalHoldUntil: schema.artifacts.legalHoldUntil,
    ownerEmail: schema.users.email,
    share: schema.artifactShares,
  }
}

function selectReports(db: Pick<DbClient, 'select'>) {
  return db
    .select(reportSelection())
    .from(schema.artifactReports)
    .leftJoin(
      schema.artifacts,
      eq(schema.artifacts.id, schema.artifactReports.artifactId),
    )
    .leftJoin(schema.users, eq(schema.users.id, schema.artifacts.userId))
    .leftJoin(
      schema.artifactShares,
      eq(schema.artifactShares.id, schema.artifactReports.shareId),
    )
}

type ReportRow = Awaited<ReturnType<ReturnType<typeof selectReports>['limit']>>[number]

function toIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null
}

function toReportSummary(
  row: ReportRow,
  now: Date,
): AdminArtifactReportSummary {
  const report = row.report
  const artifactExists = row.artifactOwnerUserId !== null

  return {
    id: report.id,
    reason: report.reason,
    priority: report.priority ?? 'normal',
    status: report.status,
    decision: report.decision ?? null,
    detailsPreview: (report.details ?? '').slice(0, DETAILS_PREVIEW_LENGTH),
    reporterUserId: report.reporterUserId,
    reporterName: report.reporterName,
    reporterEmail: report.reporterEmail,
    artifactId: encodeArtifactId(report.artifactId),
    artifact: artifactExists
      ? {
        id: encodeArtifactId(report.artifactId),
        title: row.artifactTitle!,
        kind: row.artifactKind!,
        currentVersion: row.artifactCurrentVersion!,
        ownerUserId: row.artifactOwnerUserId!,
        ownerEmail: row.ownerEmail ?? null,
        takedownAt: toIso(row.artifactTakedownAt),
        legalHoldUntil: toIso(row.artifactLegalHoldUntil),
      }
      : null,
    share: row.share
      ? {
        id: encodeArtifactShareId(row.share.id),
        status: resolveArtifactShareStatus(
          row.share,
          now,
          row.artifactTakedownAt,
        ),
        pinnedVersion: row.share.pinnedVersion,
      }
      : null,
    chatShareId: report.chatShareId ?? null,
    createdAt: report.createdAt.toISOString(),
    decidedAt: toIso(report.decidedAt),
    resolvedAt: toIso(report.resolvedAt),
  }
}

/**
 * Admin reports queue: open urgent reports first, then other open ones,
 * then closed ones, newest first inside each group.
 */
export async function listArtifactReportsForAdmin(
  input: ListArtifactReportsInput,
): Promise<{ items: AdminArtifactReportSummary[], total: number }> {
  const now = input.now ?? new Date()
  const filter = input.status
    ? eq(schema.artifactReports.status, input.status)
    : undefined
  const reports = schema.artifactReports
  const rows = await selectReports(input.db)
    .where(filter)
    .orderBy(
      sql`case
        when ${reports.status} = 'open' and ${reports.priority} = 'urgent'
          then 0
        when ${reports.status} = 'open' then 1
        else 2
      end`,
      desc(reports.createdAt),
      desc(reports.id),
    )
    .limit(input.limit)
    .offset(input.offset)
  const [totalRow] = await input.db
    .select({ total: count() })
    .from(reports)
    .where(filter)

  return {
    items: rows.map((row) => {
      return toReportSummary(row, now)
    }),
    total: Number(totalRow?.total ?? 0),
  }
}

async function findReportRow(
  db: Pick<DbClient, 'select'>,
  reportId: number,
): Promise<ReportRow | null> {
  const [row] = await selectReports(db)
    .where(eq(schema.artifactReports.id, reportId))
    .limit(1)

  return row ?? null
}

async function decryptShareUrl(
  share: ArtifactShareRow,
  baseUrl: string,
): Promise<string | null> {
  try {
    return buildArtifactShareUrl(
      await useDecryptText(share.tokenEncrypted),
      baseUrl,
    )
  } catch {
    return null
  }
}

async function resolveChatShareUrl(
  db: Pick<DbClient, 'select'>,
  chatShareId: string,
  baseUrl: string,
): Promise<string | null> {
  const [share] = await db
    .select({ slug: schema.chatShares.slug })
    .from(schema.chatShares)
    .where(eq(schema.chatShares.id, chatShareId))
    .limit(1)

  return share?.slug ? `${baseUrl}/shared/${share.slug}` : null
}

/**
 * One report with everything the admin drawer needs: the full details, the
 * decision statement, the exact reported URL (the decrypted
 * `/artifacts/<token>` link, or the shared chat URL) and the version to
 * preview: the version the reporter saw, else the link's pinned one, else the
 * current one. The URL goes to the admin only and is never logged.
 */
export async function getArtifactReportForAdmin(input: {
  db: DbClient
  reportId: number
  now?: Date
  baseUrl?: string
}): Promise<AdminArtifactReportDetail> {
  const now = input.now ?? new Date()
  const row = await findReportRow(input.db, input.reportId)

  if (!row) {
    throwAdminError(404, 'Report not found', 'unknown_report')
  }

  const baseUrl = resolveArtifactShareBaseUrl(input.baseUrl)
  let locationUrl: string | null = null

  if (row.share) {
    locationUrl = await decryptShareUrl(row.share, baseUrl)
  } else if (row.report.chatShareId) {
    locationUrl = await resolveChatShareUrl(
      input.db,
      row.report.chatShareId,
      baseUrl,
    )
  }

  const summary = toReportSummary(row, now)
  const reportedVersion = row.report.reportedVersion ?? null
  const currentVersion = summary.artifact?.currentVersion ?? null

  return {
    ...summary,
    details: row.report.details ?? '',
    decisionStatement: row.report.decisionStatement ?? null,
    receiptSentAt: toIso(row.report.receiptSentAt),
    locationUrl,
    reportedVersion,
    currentVersion,
    previewVersion: currentVersion === null
      ? null
      : reportedVersion ?? row.share?.pinnedVersion ?? currentVersion,
  }
}

function reportLocation(row: ReportRow): ArtifactReportLocation {
  const artifactId = encodeArtifactId(row.report.artifactId)

  if (row.share) {
    return {
      kind: 'artifact-share',
      artifactId,
      shareId: encodeArtifactShareId(row.share.id),
      chatShareId: null,
    }
  }

  return {
    kind: 'shared-chat',
    artifactId,
    shareId: null,
    chatShareId: row.report.chatShareId ?? null,
  }
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date)

  result.setUTCMonth(result.getUTCMonth() + months)

  return result
}

function decisionFor(
  action: ArtifactReportAction,
  scope: ArtifactReportActionScope,
): ArtifactReportDecision {
  if (action === 'reject') {
    return 'no-action'
  }

  return scope === 'share' ? 'restricted' : 'removed'
}

function outcomeFor(decision: ArtifactReportDecision): ArtifactDecisionOutcome {
  switch (decision) {
    case 'restricted':
      return 'link-disabled'
    case 'removed':
      return 'artifact-disabled'
    default:
      return 'no-action'
  }
}

function takedownSnapshot(input: {
  takedownAt: Date | null
  legalHoldUntil?: Date | null
}) {
  return {
    takedownAt: toIso(input.takedownAt),
    ...(input.legalHoldUntil === undefined
      ? {}
      : { legalHoldUntil: toIso(input.legalHoldUntil) }),
  }
}

function closeReport(
  db: AdminDb,
  reportId: number,
  input: {
    status: ArtifactReportStatus
    decision: ArtifactReportDecision
    statement: string
    now: Date
  },
) {
  return db.update(schema.artifactReports)
    .set({
      status: input.status,
      decision: input.decision,
      decisionStatement: input.statement,
      decidedAt: input.now,
      resolvedAt: input.now,
    })
    .where(and(
      eq(schema.artifactReports.id, reportId),
      eq(schema.artifactReports.status, 'open'),
    ))
    .returning({ id: schema.artifactReports.id })
}

/**
 * Undoes `closeReport` when the takedown or audit write after it failed, so
 * the report is open again for a retry. Matches the `decidedAt` just
 * written, so it never reopens a decision someone else made since. A
 * failing reopen is logged; the caller rethrows the original error.
 */
async function reopenReport(
  context: FeatureAdminContext,
  reportId: number,
  decidedAt: Date,
): Promise<void> {
  try {
    await context.db.update(schema.artifactReports)
      .set({
        status: 'open',
        decision: null,
        decisionStatement: null,
        decidedAt: null,
        resolvedAt: null,
      })
      .where(and(
        eq(schema.artifactReports.id, reportId),
        eq(schema.artifactReports.decidedAt, decidedAt),
      ))

    context.logger.set({
      attributes: { artifacts: { reportReopened: reportId } },
    })
  } catch (exception) {
    context.logger.set({
      attributes: {
        artifacts: {
          reportReopenError: exceptionMessage(exception),
          reportId,
        },
      },
    })
  }
}

async function applyReportDecision(
  context: FeatureAdminContext,
  input: {
    row: ReportRow
    action: ArtifactReportAction
    scope: ArtifactReportActionScope
    statement: string
    decision: ArtifactReportDecision
    now: Date
  },
): Promise<boolean> {
  const { row, now } = input
  const ownerUserId = row.artifactOwnerUserId

  if (input.action === 'reject') {
    await buildAuditInsert(context, {
      action: 'artifact-report.reject',
      flag: AUDIT_FLAG,
      targetUserId: ownerUserId,
      before: { reportId: row.report.id, status: 'open' },
      after: {
        reportId: row.report.id,
        status: 'rejected',
        decision: input.decision,
      },
    })

    return false
  }

  const takedown = input.scope === 'share'
    ? buildShareTakedown(context.db, row.share!.id, input.statement, now)
    : context.db.update(schema.artifacts)
      .set({ takedownAt: now, takedownReason: input.statement })
      .where(and(
        eq(schema.artifacts.id, row.report.artifactId),
        isNull(schema.artifacts.takedownAt),
      ))
      .returning({ id: schema.artifacts.id })
  const before = input.scope === 'share'
    ? row.share!.takedownAt
    : row.artifactTakedownAt
  const [updated] = await context.db.batch([
    takedown,
    buildAuditInsert(context, {
      action: 'artifact.takedown',
      flag: AUDIT_FLAG,
      targetUserId: ownerUserId,
      before: {
        reportId: row.report.id,
        ...takedownSnapshot({ takedownAt: before }),
      },
      after: {
        reportId: row.report.id,
        scope: input.scope,
        artifactId: encodeArtifactId(row.report.artifactId),
        shareId: row.share ? encodeArtifactShareId(row.share.id) : null,
        ...takedownSnapshot({ takedownAt: before ?? now }),
      },
    }),
  ])

  return updated.length > 0
}

async function findOwnerEmail(
  db: AdminDb,
  userId: number,
): Promise<string | null> {
  const [owner] = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1)

  return owner?.email ?? null
}

/**
 * Decides an open report. `takedown` with scope `share` disables only the
 * reported `/artifacts/<token>` link (the share row's takedown fields); with
 * `all-shares` it disables the artifact itself, so every link, the
 * shared-chat route and the owner view stop on the next request. `reject`
 * closes the report with no action. The report is closed first (only if it
 * is still open, so two admins deciding at once cannot both act: the second
 * gets 409); the takedown and the audit row then go in one D1 batch, and if
 * that batch (or the reject audit row) fails the report is reopened and the
 * error rethrown, so it never stays closed with nothing done. The owner gets
 * the statement of reasons when content was newly taken down (a second
 * report on content already down sends none), the reporter gets the decision
 * when they left an email. Email failures are logged, never thrown.
 */
export async function decideArtifactReport(
  context: FeatureAdminContext,
  input: {
    reportId: number
    action: ArtifactReportAction
    statement: string
    scope: ArtifactReportActionScope
  },
): Promise<ArtifactReportDecisionResult> {
  const now = context.now ?? new Date()
  const row = await findReportRow(context.db as DbClient, input.reportId)

  if (!row) {
    throwAdminError(404, 'Report not found', 'unknown_report')
  }

  if (row.report.status !== 'open') {
    throwAdminError(
      409,
      'This report is already decided',
      'report_closed',
      'Open the report list again to see the decision',
    )
  }

  const decision = decisionFor(input.action, input.scope)

  if (input.action === 'takedown' && row.artifactOwnerUserId === null) {
    throwAdminError(
      409,
      'The reported artifact no longer exists',
      'artifact_deleted',
      'Reject the report instead; there is nothing left to take down',
    )
  }

  if (input.action === 'takedown' && input.scope === 'share' && !row.share) {
    throwAdminError(
      400,
      'This report has no share link to disable',
      'report_without_share',
      'Use scope all-shares to disable the artifact itself',
    )
  }

  assertReportClosed(await closeReport(context.db, row.report.id, {
    status: input.action === 'reject' ? 'rejected' : 'actioned',
    decision,
    statement: input.statement,
    now,
  }))

  let newlyTakenDown: boolean

  try {
    newlyTakenDown = await applyReportDecision(context, {
      row,
      action: input.action,
      scope: input.scope,
      statement: input.statement,
      decision,
      now,
    })
  } catch (exception) {
    await reopenReport(context, row.report.id, now)

    throw exception
  }

  context.logger.set({
    attributes: {
      artifacts: {
        operation: 'report-decision',
        reportId: row.report.id,
        action: input.action,
        scope: input.scope,
        decision,
        newlyTakenDown,
      },
    },
  })

  await sendDecisionEmails(context, {
    row,
    decision,
    scope: input.scope,
    statement: input.statement,
    newlyTakenDown,
    now,
  })

  return {
    reportId: row.report.id,
    status: input.action === 'reject' ? 'rejected' : 'actioned',
    decision,
    newlyTakenDown,
  }
}

function assertReportClosed(closed: unknown): void {
  if (Array.isArray(closed) && closed.length > 0) {
    return
  }

  throwAdminError(
    409,
    'This report is already decided',
    'report_closed',
    'Open the report list again to see the decision',
  )
}

async function sendDecisionEmails(
  context: FeatureAdminContext,
  input: {
    row: ReportRow
    decision: ArtifactReportDecision
    scope: ArtifactReportActionScope
    statement: string
    newlyTakenDown: boolean
    now: Date
  },
): Promise<void> {
  const { row } = input

  if (input.newlyTakenDown && row.artifactOwnerUserId !== null) {
    await sendArtifactStatementOfReasonsEmail({
      to: row.ownerEmail ?? '',
      artifacts: [{
        id: encodeArtifactId(row.report.artifactId),
        title: row.artifactTitle ?? '',
      }],
      scope: input.scope === 'share' ? 'share' : 'artifact',
      shareId: row.share ? encodeArtifactShareId(row.share.id) : null,
      decidedAt: input.now,
      statement: input.statement,
      followedReport: true,
      legalHoldUntil: row.artifactLegalHoldUntil,
      logger: context.logger,
    })
  }

  if (!row.report.reporterEmail) {
    return
  }

  await sendArtifactReportDecisionEmail({
    to: row.report.reporterEmail,
    reportedAt: row.report.createdAt,
    decidedAt: input.now,
    location: reportLocation(row),
    outcome: outcomeFor(input.decision),
    statement: input.statement,
    logger: context.logger,
  })
}

interface ResolvedTakedownTarget {
  share: ArtifactShareRow | null
  artifacts: ArtifactRow[]
  ownerUserId: number
}

async function findArtifactRow(
  db: AdminDb,
  artifactId: number,
): Promise<ArtifactRow | null> {
  const [artifact] = await db
    .select()
    .from(schema.artifacts)
    .where(and(
      eq(schema.artifacts.id, artifactId),
      gt(schema.artifacts.currentVersion, 0),
    ))
    .limit(1)

  return artifact ?? null
}

async function findUserIdByTarget(
  db: AdminDb,
  target: string,
): Promise<number | null> {
  const trimmed = target.trim()

  if (/^\d+$/.test(trimmed)) {
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, Number(trimmed)))
      .limit(1)

    return user?.id ?? null
  }

  if (!trimmed.includes('@')) {
    return null
  }

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${trimmed.toLowerCase()}`)
    .limit(1)

  return user?.id ?? null
}

async function listUserArtifacts(
  db: AdminDb,
  userId: number,
): Promise<ArtifactRow[]> {
  return await db
    .select()
    .from(schema.artifacts)
    .where(and(
      eq(schema.artifacts.userId, userId),
      gt(schema.artifacts.currentVersion, 0),
    ))
}

function throwTargetNotFound(): never {
  throwAdminError(
    404,
    'Nothing matches this target',
    'unknown_takedown_target',
    'Paste the full /artifacts/ link, the token, an artifact id, or for '
    + 'scope user a user id or email',
  )
}

/**
 * Resolves what a direct takedown targets. A full `/artifacts/<token>` link
 * or a bare token is hashed and looked up first; then, for scope `user`, a user
 * id or email; then an artifact id. The raw target is never logged.
 */
async function resolveTakedownTarget(
  db: AdminDb,
  target: string,
  scope: ArtifactTakedownScope,
): Promise<ResolvedTakedownTarget> {
  const token = extractArtifactShareToken(target)
  const byToken = token
    ? await findArtifactShareByToken({ db: db as DbClient, token })
    : null

  if (scope === 'share') {
    if (!byToken) {
      throwAdminError(
        404,
        'No share link matches this target',
        'unknown_share_target',
        'Paste the full /artifacts/ link or its token',
      )
    }

    return {
      share: byToken.share,
      artifacts: [byToken.artifact],
      ownerUserId: byToken.artifact.userId,
    }
  }

  let artifact = byToken?.artifact ?? null

  if (scope === 'user') {
    const userId = artifact?.userId ?? await findUserIdByTarget(db, target)
      ?? await findArtifactOwnerByPublicId(db, target)

    if (userId === null) {
      throwTargetNotFound()
    }

    const artifacts = await listUserArtifacts(db, userId)

    if (artifacts.length === 0) {
      throwAdminError(404, 'This user has no artifacts', 'no_artifacts')
    }

    return { share: null, artifacts, ownerUserId: userId }
  }

  if (!artifact) {
    const internalId = decodeArtifactId(target.trim())

    artifact = internalId === null
      ? null
      : await findArtifactRow(db, internalId)
  }

  if (!artifact) {
    throwTargetNotFound()
  }

  return { share: null, artifacts: [artifact], ownerUserId: artifact.userId }
}

async function findArtifactOwnerByPublicId(
  db: AdminDb,
  target: string,
): Promise<number | null> {
  const internalId = decodeArtifactId(target.trim())

  if (internalId === null) {
    return null
  }

  const artifact = await findArtifactRow(db, internalId)

  return artifact?.userId ?? null
}

function buildArtifactTakedowns(
  db: AdminDb,
  artifactIds: number[],
  statement: string,
  now: Date,
) {
  return chunkIds(artifactIds).map((ids) => {
    return db.update(schema.artifacts)
      .set({ takedownAt: now, takedownReason: statement })
      .where(and(
        inArray(schema.artifacts.id, ids),
        isNull(schema.artifacts.takedownAt),
      ))
      .returning({ id: schema.artifacts.id })
  })
}

function buildShareTakedown(
  db: AdminDb,
  shareId: number,
  statement: string,
  now: Date,
) {
  return db.update(schema.artifactShares)
    .set({ takedownAt: now, takedownReason: statement, updatedAt: now })
    .where(and(
      eq(schema.artifactShares.id, shareId),
      isNull(schema.artifactShares.takedownAt),
    ))
    .returning({ id: schema.artifactShares.id })
}

function buildLegalHolds(
  db: AdminDb,
  artifactIds: number[],
  holdUntil: Date,
) {
  return chunkIds(artifactIds).map((ids) => {
    return db.update(schema.artifacts)
      .set({ legalHoldUntil: holdUntil })
      .where(and(
        inArray(schema.artifacts.id, ids),
        sql`coalesce(${schema.artifacts.legalHoldUntil}, 0) < ${
          Math.floor(holdUntil.getTime() / 1000)
        }`,
      ))
  })
}

function collectReturnedIds(results: unknown[]): number[] {
  return results.flatMap((result) => {
    if (!Array.isArray(result)) {
      return []
    }

    return result.map((row: { id: number }) => {
      return row.id
    })
  })
}

/**
 * A per-user deny grant for `artifacts.share` (upserted over any existing
 * grant) and its `grant.set` audit row, for the takedown batch of scope
 * `user`: the owner cannot publish new links until an admin removes the
 * deny grant in the features admin.
 */
async function buildShareDenial(
  context: FeatureAdminContext,
  userId: number,
  now: Date,
) {
  const [existing] = await context.db
    .select()
    .from(schema.featureGrants)
    .where(and(
      eq(schema.featureGrants.userId, userId),
      eq(schema.featureGrants.flag, ARTIFACT_SHARE_FLAG),
    ))
    .limit(1)
  const denial = {
    userId,
    effect: 'deny' as const,
    variant: null,
    expiresAt: null,
    reason: ARTIFACT_SHARE_DENY_REASON,
  }

  return [
    context.db
      .insert(schema.featureGrants)
      .values({
        ...denial,
        flag: ARTIFACT_SHARE_FLAG,
        grantedBy: context.actor.userId,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.featureGrants.userId, schema.featureGrants.flag],
        set: {
          effect: denial.effect,
          variant: denial.variant,
          expiresAt: denial.expiresAt,
          reason: denial.reason,
          grantedBy: context.actor.userId,
          createdAt: now,
        },
      }),
    buildAuditInsert(context, {
      action: 'grant.set',
      flag: ARTIFACT_SHARE_FLAG,
      targetUserId: userId,
      before: existing ? toGrantSnapshot(existing) : null,
      after: toGrantSnapshot(denial),
    }),
  ]
}

/**
 * Takes content down without a report (a TCO removal order, an abuse
 * complaint, something the admin found): scope `share` disables one link,
 * `artifact` the artifact and every link to it, `user` every artifact of
 * that user and also writes a deny grant for `artifacts.share`, so the
 * owner cannot republish. `legalHold` keeps the artifacts for six months
 * (TCO Art. 6(2)) against deletion and the report sweep. The takedown
 * updates, the legal hold, the deny grant and the audit rows are one D1
 * batch, so a failure leaves nothing half-written; the owner's statement of
 * reasons (for what was newly taken down) is sent after it. Takes effect on
 * the next request: every read checks D1 and nothing is cached.
 */
export async function takeDownArtifactTarget(
  context: FeatureAdminContext,
  input: {
    target: string
    statement: string
    scope: ArtifactTakedownScope
    legalHold: boolean
  },
): Promise<ArtifactTakedownResult> {
  const now = context.now ?? new Date()
  const resolved = await resolveTakedownTarget(
    context.db,
    input.target,
    input.scope,
  )
  const artifactIds = resolved.artifacts.map((artifact) => {
    return artifact.id
  })
  const holdUntil = input.legalHold
    ? addMonths(now, ARTIFACT_LEGAL_HOLD_MONTHS)
    : null
  const pendingCount = resolved.share
    ? Number(!resolved.share.takedownAt)
    : resolved.artifacts.filter((artifact) => {
      return !artifact.takedownAt
    }).length
  const publicArtifactIds = artifactIds.map(encodeArtifactId)
  const shareId = resolved.share
    ? encodeArtifactShareId(resolved.share.id)
    : null
  const singleArtifact = resolved.artifacts.length === 1
    ? resolved.artifacts[0]!
    : null
  const before = resolved.share
    ? takedownSnapshot({
      takedownAt: resolved.share.takedownAt,
      legalHoldUntil: singleArtifact?.legalHoldUntil ?? null,
    })
    : singleArtifact
      ? takedownSnapshot({
        takedownAt: singleArtifact.takedownAt,
        legalHoldUntil: singleArtifact.legalHoldUntil,
      })
      : {
        artifactCount: artifactIds.length,
        alreadyTakenDown: artifactIds.length - pendingCount,
      }
  const takedowns = resolved.share
    ? [buildShareTakedown(
      context.db,
      resolved.share.id,
      input.statement,
      now,
    )]
    : buildArtifactTakedowns(context.db, artifactIds, input.statement, now)
  const holds = holdUntil
    ? buildLegalHolds(context.db, artifactIds, holdUntil)
    : []
  const audit = buildAuditInsert(context, {
    action: 'artifact.takedown',
    flag: AUDIT_FLAG,
    targetUserId: resolved.ownerUserId,
    before,
    after: {
      scope: input.scope,
      shareId,
      artifactIds: publicArtifactIds.slice(0, AUDIT_ID_LIST_MAX),
      artifactCount: artifactIds.length,
      takenDown: pendingCount,
      takedownAt: now.toISOString(),
      legalHoldUntil: toIso(holdUntil),
    },
  })
  const shareDenial = input.scope === 'user'
    ? await buildShareDenial(context, resolved.ownerUserId, now)
    : []
  const results = await context.db.batch([
    ...takedowns,
    ...holds,
    audit,
    ...shareDenial,
  ] as unknown as Parameters<AdminDb['batch']>[0])

  if (shareDenial.length > 0) {
    logFeatureAccess(context, {
      action: 'grant.set',
      flag: ARTIFACT_SHARE_FLAG,
      targetUserId: resolved.ownerUserId,
      effect: 'deny',
      expiresAt: null,
    })
  }

  const returnedIds = collectReturnedIds(
    (results as unknown as unknown[]).slice(0, takedowns.length),
  )
  const shareTakenDown = resolved.share !== null && returnedIds.length > 0
  const newlyTakenDownIds = resolved.share
    ? shareTakenDown ? artifactIds : []
    : returnedIds

  context.logger.set({
    attributes: {
      artifacts: {
        operation: 'direct-takedown',
        scope: input.scope,
        shareId,
        artifactCount: artifactIds.length,
        takenDown: newlyTakenDownIds.length,
        legalHold: input.legalHold,
        ownerUserId: resolved.ownerUserId,
      },
    },
  })

  if (newlyTakenDownIds.length > 0) {
    const newlyTakenDown = new Set(newlyTakenDownIds)

    await sendArtifactStatementOfReasonsEmail({
      to: await findOwnerEmail(context.db, resolved.ownerUserId) ?? '',
      artifacts: resolved.artifacts
        .filter((artifact) => {
          return newlyTakenDown.has(artifact.id)
        })
        .map((artifact) => {
          return { id: encodeArtifactId(artifact.id), title: artifact.title }
        }),
      scope: input.scope,
      shareId,
      decidedAt: now,
      statement: input.statement,
      followedReport: false,
      legalHoldUntil: holdUntil,
      logger: context.logger,
    })
  }

  return {
    scope: input.scope,
    takenDown: newlyTakenDownIds.length,
    alreadyTakenDown: artifactIds.length - newlyTakenDownIds.length,
    artifactIds: publicArtifactIds,
    shareId,
    ownerUserId: resolved.ownerUserId,
    legalHoldUntil: toIso(holdUntil),
  }
}

/**
 * Lifts a takedown of one artifact or one share link: clears the takedown
 * fields and keeps any legal hold. Sends no email: a restore follows a
 * person's review of a dispute that runs by email from the privacy mailbox,
 * and the reply to the owner (and, for copyright, the notice to the
 * reporter) is written there. The update and the audit row are one D1
 * batch; the update only clears a takedown that is still set. A D1 batch
 * cannot make the audit insert depend on it, so when two restores race
 * past the pre-check the loser deletes its own audit row right after the
 * batch and answers 409; if that delete fails, one extra audit row stays
 * (logged). Viewer saved progress deleted by the sweep after the takedown
 * does not come back.
 */
export async function restoreArtifactTakedown(
  context: FeatureAdminContext,
  input: { artifactId?: string, shareId?: string },
): Promise<ArtifactRestoreResult> {
  if (input.shareId) {
    return await restoreShare(context, input.shareId)
  }

  return await restoreArtifact(context, input.artifactId ?? '')
}

function throwNotTakenDown(): never {
  throwAdminError(409, 'This is not taken down', 'not_taken_down')
}

async function discardRestoreAudit(
  context: FeatureAdminContext,
  audited: Array<{ id: number }>,
): Promise<void> {
  const ids = audited.map((row) => {
    return row.id
  })

  if (ids.length === 0) {
    return
  }

  try {
    await context.db.delete(schema.featureAuditLog)
      .where(inArray(schema.featureAuditLog.id, ids))
  } catch (exception) {
    context.logger.set({
      attributes: {
        artifacts: { restoreAuditDiscardError: exceptionMessage(exception) },
      },
    })
  }
}

async function restoreShare(
  context: FeatureAdminContext,
  publicShareId: string,
): Promise<ArtifactRestoreResult> {
  const shareInternalId = decodeArtifactShareId(publicShareId)
  const [share] = shareInternalId === null
    ? []
    : await context.db
      .select()
      .from(schema.artifactShares)
      .where(eq(schema.artifactShares.id, shareInternalId))
      .limit(1)

  if (!share) {
    throwAdminError(404, 'Share link not found', 'unknown_share')
  }

  if (!share.takedownAt) {
    throwNotTakenDown()
  }

  const now = context.now ?? new Date()
  const [updated, audited] = await context.db.batch([
    context.db.update(schema.artifactShares)
      .set({ takedownAt: null, takedownReason: null, updatedAt: now })
      .where(and(
        eq(schema.artifactShares.id, share.id),
        isNotNull(schema.artifactShares.takedownAt),
      ))
      .returning({ id: schema.artifactShares.id }),
    buildAuditInsert(context, {
      action: 'artifact.restore',
      flag: AUDIT_FLAG,
      targetUserId: share.userId,
      before: { shareId: publicShareId, takedownAt: toIso(share.takedownAt) },
      after: { shareId: publicShareId, takedownAt: null },
    }).returning({ id: schema.featureAuditLog.id }),
  ])

  if (updated.length === 0) {
    await discardRestoreAudit(context, audited)
    throwNotTakenDown()
  }

  context.logger.set({
    attributes: {
      artifacts: { operation: 'restore', shareId: publicShareId },
    },
  })

  return { restored: true, artifactId: null, shareId: publicShareId }
}

async function restoreArtifact(
  context: FeatureAdminContext,
  publicArtifactId: string,
): Promise<ArtifactRestoreResult> {
  const internalId = decodeArtifactId(publicArtifactId)
  const artifact = internalId === null
    ? null
    : await findArtifactRow(context.db, internalId)

  if (!artifact) {
    throwAdminError(404, 'Artifact not found', 'unknown_artifact')
  }

  if (!artifact.takedownAt) {
    throwNotTakenDown()
  }

  const [updated, audited] = await context.db.batch([
    context.db.update(schema.artifacts)
      .set({ takedownAt: null, takedownReason: null })
      .where(and(
        eq(schema.artifacts.id, artifact.id),
        isNotNull(schema.artifacts.takedownAt),
      ))
      .returning({ id: schema.artifacts.id }),
    buildAuditInsert(context, {
      action: 'artifact.restore',
      flag: AUDIT_FLAG,
      targetUserId: artifact.userId,
      before: {
        artifactId: publicArtifactId,
        takedownAt: toIso(artifact.takedownAt),
        legalHoldUntil: toIso(artifact.legalHoldUntil),
      },
      after: {
        artifactId: publicArtifactId,
        takedownAt: null,
        legalHoldUntil: toIso(artifact.legalHoldUntil),
      },
    }).returning({ id: schema.featureAuditLog.id }),
  ])

  if (updated.length === 0) {
    await discardRestoreAudit(context, audited)
    throwNotTakenDown()
  }

  context.logger.set({
    attributes: {
      artifacts: { operation: 'restore', artifactId: publicArtifactId },
    },
  })

  return { restored: true, artifactId: publicArtifactId, shareId: null }
}
