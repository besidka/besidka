import type { RequestEvent } from 'nuxt/server'
import type { LegalNotice } from '#shared/utils/legal-notices'
import type {
  ConsentVersionApprovalInput,
  LegalNoticeApprovalInput,
  LegalNoticeOptOutInput,
} from '#shared/utils/legal-admin-schemas'
import type {
  FeatureAdminAction,
  FeatureAdminContext,
} from '~~/server/utils/features/admin'
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import {
  LEGAL_NOTICES,
  getLegalNoticeById,
  parseNoticeEffectiveInstant,
  parseNoticeInstant,
} from '#shared/utils/legal-notices'
import { LEGAL_ADMIN_OPT_OUT_LIST_LIMIT } from '#shared/utils/legal-admin-schemas'
import * as schema from '~~/server/db/schema'
import {
  buildAuditInsert,
  throwAdminError,
} from '~~/server/utils/features/admin'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import {
  CURRENT_CONSENT_TEXT_SHA256,
  CURRENT_CONSENT_VERSION,
} from '~~/server/utils/legal/consent'
import {
  BASELINE_APPROVED_CONSENT_VERSION,
  cacheApprovedConsentVersion,
  compareConsentVersions,
  readApprovedConsentVersionFromDb,
  rememberApprovedConsentVersion,
  resolveEffectiveConsentVersion,
} from '~~/server/utils/legal/consent-version'
import {
  countDeliveriesSinceApproval,
  hashLegalNotice,
  readActiveLegalNoticeApprovals,
} from '~~/server/utils/legal/notice-approvals'
import { countLegalNoticeRecipients } from '~~/server/utils/legal/notice-sweep'

type LegalAdminReadDatabase = Pick<ReturnType<typeof useDb>, 'select'>

type LegalNoticeWindowState = 'upcoming' | 'open' | 'closed'

type LegalNoticeApprovalState = 'none' | 'approved' | 'changed'

const NOTICE_ID_PATTERN = /^[a-z0-9-]{1,100}$/

const UNIQUE_CONSTRAINT_MESSAGE = 'UNIQUE CONSTRAINT FAILED'

interface LegalNoticeDeliveryCounts {
  sent: number
  skipped: number
  failed: number
  sending: number
}

function emptyDeliveryCounts(): LegalNoticeDeliveryCounts {
  return { sent: 0, skipped: 0, failed: 0, sending: 0 }
}

function isUniqueConstraintViolation(exception: unknown): boolean {
  let current: unknown = exception

  for (let depth = 0; depth < 5 && current; depth++) {
    if (
      current instanceof Error
      && current.message.toUpperCase().includes(UNIQUE_CONSTRAINT_MESSAGE)
    ) {
      return true
    }

    current = current instanceof Error ? current.cause : undefined
  }

  return false
}

function resolveNow(context: Pick<FeatureAdminContext, 'now'>): Date {
  return context.now ?? new Date()
}

/**
 * Legal notice emails and consent versions are approved only by a person in
 * the admin UI, never by an MCP client or a schedule. The HTTP routes under
 * `/api/v1/admin/legal/` are UI-only by construction: they build their
 * context with `createFeatureAdminWriteContext`, whose actor kind is `ui`.
 * An MCP admin tool must never call these writers, even with a `ui` actor.
 */
function assertAdminInterface(context: FeatureAdminContext): void {
  if (context.actor.kind === 'ui') {
    return
  }

  throwAdminError(
    403,
    'Only the admin area can change this',
    'legal_admin_ui_only',
  )
}

function logLegalAdmin(
  context: FeatureAdminContext,
  entry: {
    action: FeatureAdminAction
    noticeId?: string
    version?: string
    targetUserId?: number
    recipientEstimate?: number
  },
): void {
  context.logger.set({
    attributes: {
      legalAdmin: {
        ...entry,
        actorKind: context.actor.kind,
      },
    },
  })
}

function getNoticeWindowState(
  notice: LegalNotice,
  now: Date,
): LegalNoticeWindowState {
  const timestamp = now.getTime()

  if (timestamp < parseNoticeInstant(notice.sendFrom)) {
    return 'upcoming'
  }

  if (timestamp < parseNoticeEffectiveInstant(notice.effectiveAt)) {
    return 'open'
  }

  return 'closed'
}

export function readLegalNoticeIdParam(event: RequestEvent): string {
  const params = z.object({
    id: z.string().trim().regex(NOTICE_ID_PATTERN),
  }).safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throwAdminError(400, 'Invalid request parameters', params.error.message)
  }

  return params.data.id
}

function requireKnownNotice(noticeId: string): LegalNotice {
  const notice = getLegalNoticeById(noticeId)

  if (!notice) {
    throwAdminError(404, 'Notice not found', 'unknown_notice')
  }

  return notice
}

async function readDeliveryCounts(
  db: LegalAdminReadDatabase,
): Promise<Map<string, LegalNoticeDeliveryCounts>> {
  const rows = await db
    .select({
      noticeId: schema.legalNoticeDeliveries.noticeId,
      status: schema.legalNoticeDeliveries.status,
      total: count(),
    })
    .from(schema.legalNoticeDeliveries)
    .groupBy(
      schema.legalNoticeDeliveries.noticeId,
      schema.legalNoticeDeliveries.status,
    )
  const counts = new Map<string, LegalNoticeDeliveryCounts>()

  for (const row of rows) {
    const noticeCounts = counts.get(row.noticeId) ?? emptyDeliveryCounts()

    noticeCounts[row.status] = row.total
    counts.set(row.noticeId, noticeCounts)
  }

  return counts
}

async function readUserEmails(
  db: LegalAdminReadDatabase,
  userIds: number[],
): Promise<Map<number, string>> {
  const uniqueIds = [...new Set(userIds)]

  if (uniqueIds.length === 0) {
    return new Map()
  }

  const rows = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(inArray(schema.users.id, uniqueIds))

  return new Map(rows.map((row) => {
    return [row.id, row.email]
  }))
}

async function readApprovedConsentVersion(
  db: LegalAdminReadDatabase,
): Promise<string> {
  return await readApprovedConsentVersionFromDb(db)
    ?? BASELINE_APPROVED_CONSENT_VERSION
}

async function countUsersOnConsentVersion(
  db: LegalAdminReadDatabase,
  version: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.userSettings)
    .where(and(
      eq(schema.userSettings.termsVersion, version),
      eq(schema.userSettings.sensitiveContentConsentVersion, version),
    ))

  return row?.total ?? 0
}

/**
 * Everything the Legal admin page shows: each notice in code with its send
 * window, delivery counts, the number of users the sweep would email right
 * now and the owner's approval; the code and approved consent versions; the
 * legal notice email opt-outs.
 */
export async function getLegalAdminOverview(
  db: LegalAdminReadDatabase,
  input: { sweepEnabled: boolean, now?: Date },
) {
  const now = input.now ?? new Date()
  const approvals = await readActiveLegalNoticeApprovals(db)
  const deliveryCounts = await readDeliveryCounts(db)
  const notices = []

  for (const notice of [...LEGAL_NOTICES].reverse()) {
    const approval = approvals.get(notice.id)
    let approvalState: LegalNoticeApprovalState = 'none'

    if (approval) {
      approvalState = approval.noticeHash === await hashLegalNotice(notice)
        ? 'approved'
        : 'changed'
    }

    notices.push({
      id: notice.id,
      documents: [...notice.documents],
      publishedAt: notice.publishedAt,
      sendFrom: notice.sendFrom,
      effectiveAt: notice.effectiveAt,
      summary: [...notice.summary],
      windowState: getNoticeWindowState(notice, now),
      deliveries: deliveryCounts.get(notice.id) ?? emptyDeliveryCounts(),
      recipientsNow: await countLegalNoticeRecipients(db, notice, now),
      approval: {
        state: approvalState,
        approvedAt: approval?.approvedAt.toISOString() ?? null,
        approvedBy: approval?.approvedBy ?? null,
        recipientEstimate: approval?.recipientEstimate ?? null,
        deliveredSinceApproval: approval
          ? await countDeliveriesSinceApproval(db, approval)
          : null,
      },
    })
  }

  const approvedVersion = await readApprovedConsentVersion(db)
  const effectiveVersion = resolveEffectiveConsentVersion(
    CURRENT_CONSENT_VERSION,
    approvedVersion,
  )
  const consentApprovals = await db
    .select({
      id: schema.legalConsentVersionApprovals.id,
      version: schema.legalConsentVersionApprovals.version,
      approvedBy: schema.legalConsentVersionApprovals.approvedBy,
      approvedAt: schema.legalConsentVersionApprovals.approvedAt,
    })
    .from(schema.legalConsentVersionApprovals)
    .orderBy(desc(schema.legalConsentVersionApprovals.id))
    .limit(10)
  const optOuts = await db
    .select({
      userId: schema.legalNoticeEmailOptOuts.userId,
      email: schema.users.email,
      source: schema.legalNoticeEmailOptOuts.source,
      createdAt: schema.legalNoticeEmailOptOuts.createdAt,
    })
    .from(schema.legalNoticeEmailOptOuts)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.legalNoticeEmailOptOuts.userId),
    )
    .orderBy(desc(schema.legalNoticeEmailOptOuts.id))
    .limit(LEGAL_ADMIN_OPT_OUT_LIST_LIMIT)
  const approverEmails = await readUserEmails(db, [
    ...notices.flatMap((notice) => {
      return notice.approval.approvedBy ? [notice.approval.approvedBy] : []
    }),
    ...consentApprovals.flatMap((approval) => {
      return approval.approvedBy ? [approval.approvedBy] : []
    }),
  ])

  return {
    sweepEnabled: input.sweepEnabled,
    notices: notices.map((notice) => {
      const { approvedBy, ...approval } = notice.approval

      return {
        ...notice,
        approval: {
          ...approval,
          approvedByEmail: approvedBy
            ? approverEmails.get(approvedBy) ?? null
            : null,
        },
      }
    }),
    consent: {
      codeVersion: CURRENT_CONSENT_VERSION,
      approvedVersion,
      effectiveVersion,
      isCodeVersionApproved: compareConsentVersions(
        CURRENT_CONSENT_VERSION,
        approvedVersion,
      ) <= 0,
      usersOnEffectiveVersion: await countUsersOnConsentVersion(
        db,
        effectiveVersion,
      ),
      approvals: consentApprovals.map((approval) => {
        return {
          id: approval.id,
          version: approval.version,
          approvedAt: approval.approvedAt.toISOString(),
          approvedByEmail: approval.approvedBy
            ? approverEmails.get(approval.approvedBy) ?? null
            : null,
        }
      }),
    },
    optOuts: optOuts.map((optOut) => {
      return {
        userId: optOut.userId,
        email: optOut.email,
        source: optOut.source,
        createdAt: optOut.createdAt.toISOString(),
      }
    }),
  }
}

/**
 * Records the owner's approval to email `noticeId`. The client sends the
 * recipient count it showed in the confirmation; a different count now
 * refuses the approval, so the owner always confirms the real number.
 */
export async function approveLegalNotice(
  context: FeatureAdminContext,
  noticeId: string,
  input: LegalNoticeApprovalInput,
) {
  assertAdminInterface(context)

  const notice = requireKnownNotice(noticeId)
  const now = resolveNow(context)

  if (getNoticeWindowState(notice, now) === 'closed') {
    throwAdminError(
      409,
      'This notice is already in effect',
      'notice_already_effective',
      'A notice can be emailed only before its effective date',
    )
  }

  const approvals = await readActiveLegalNoticeApprovals(context.db)

  if (approvals.has(notice.id)) {
    throwAdminError(409, 'This notice is already approved', 'notice_approved')
  }

  const recipientEstimate = await countLegalNoticeRecipients(
    context.db,
    notice,
    now,
  )

  if (recipientEstimate !== input.recipientEstimate) {
    throwAdminError(
      409,
      'The number of recipients changed',
      `expected ${input.recipientEstimate}, now ${recipientEstimate}`,
      'Reload the page and confirm the new number',
    )
  }

  const noticeHash = await hashLegalNotice(notice)

  try {
    await context.db.batch([
      context.db.insert(schema.legalNoticeApprovals).values({
        noticeId: notice.id,
        noticeHash,
        recipientEstimate,
        approvedBy: context.actor.userId,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
      buildAuditInsert(context, {
        action: 'legal-notice.approve',
        flag: null,
        targetUserId: null,
        before: null,
        after: { noticeId: notice.id, noticeHash, recipientEstimate },
      }),
    ])
  } catch (exception) {
    if (isUniqueConstraintViolation(exception)) {
      throwAdminError(409, 'This notice is already approved', 'notice_approved')
    }

    throw exception
  }

  logLegalAdmin(context, {
    action: 'legal-notice.approve',
    noticeId: notice.id,
    recipientEstimate,
  })

  return {
    noticeId: notice.id,
    approvedAt: now.toISOString(),
    recipientEstimate,
  }
}

/**
 * Withdraws the active approval of `noticeId`. The next sweep tick sends
 * nothing more for it; a tick already running finishes its current batch.
 */
export async function withdrawLegalNoticeApproval(
  context: FeatureAdminContext,
  noticeId: string,
) {
  assertAdminInterface(context)

  const notice = requireKnownNotice(noticeId)
  const now = resolveNow(context)
  const approval = (await readActiveLegalNoticeApprovals(context.db))
    .get(notice.id)

  if (!approval) {
    throwAdminError(404, 'This notice is not approved', 'notice_not_approved')
  }

  await context.db.batch([
    context.db
      .update(schema.legalNoticeApprovals)
      .set({
        withdrawnAt: now,
        withdrawnBy: context.actor.userId,
        updatedAt: now,
      })
      .where(and(
        eq(schema.legalNoticeApprovals.id, approval.id),
        isNull(schema.legalNoticeApprovals.withdrawnAt),
      )),
    buildAuditInsert(context, {
      action: 'legal-notice.withdraw',
      flag: null,
      targetUserId: null,
      before: {
        noticeId: notice.id,
        noticeHash: approval.noticeHash,
        recipientEstimate: approval.recipientEstimate,
      },
      after: null,
    }),
  ])

  logLegalAdmin(context, {
    action: 'legal-notice.withdraw',
    noticeId: notice.id,
  })

  return { noticeId: notice.id, withdrawnAt: now.toISOString() }
}

/**
 * Approves the consent version in code. Only `CURRENT_CONSENT_VERSION` can
 * be approved, and only when it is newer than the approved one; from the
 * next request every user whose consent carries an older version is asked
 * again.
 */
export async function approveConsentVersion(
  context: FeatureAdminContext,
  input: ConsentVersionApprovalInput,
) {
  assertAdminInterface(context)

  if (input.version !== CURRENT_CONSENT_VERSION) {
    throwAdminError(
      409,
      'This is not the consent version in code',
      `requested ${input.version}, code has ${CURRENT_CONSENT_VERSION}`,
      'Reload the page and approve the version shown',
    )
  }

  const approvedVersion = await readApprovedConsentVersion(context.db)

  if (compareConsentVersions(input.version, approvedVersion) <= 0) {
    throwAdminError(
      409,
      'This consent version is already approved',
      'consent_version_approved',
    )
  }

  const now = resolveNow(context)

  await context.db.batch([
    context.db.insert(schema.legalConsentVersionApprovals).values({
      version: input.version,
      consentTextSha256: CURRENT_CONSENT_TEXT_SHA256,
      approvedBy: context.actor.userId,
      approvedAt: now,
      createdAt: now,
    }),
    buildAuditInsert(context, {
      action: 'legal-consent-version.approve',
      flag: null,
      targetUserId: null,
      before: { version: approvedVersion },
      after: {
        version: input.version,
        consentTextSha256: CURRENT_CONSENT_TEXT_SHA256,
      },
    }),
  ])

  rememberApprovedConsentVersion(input.version, now.getTime())
  await cacheApprovedConsentVersion(input.version, context.kv)

  logLegalAdmin(context, {
    action: 'legal-consent-version.approve',
    version: input.version,
  })

  return {
    version: input.version,
    previousVersion: approvedVersion,
    approvedAt: now.toISOString(),
  }
}

async function requireExistingUser(
  db: LegalAdminReadDatabase,
  userId: number,
): Promise<void> {
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1)

  if (!user) {
    throwAdminError(404, 'User not found', 'user_not_found')
  }
}

async function readOptOut(db: LegalAdminReadDatabase, userId: number) {
  const [optOut] = await db
    .select({
      id: schema.legalNoticeEmailOptOuts.id,
      source: schema.legalNoticeEmailOptOuts.source,
    })
    .from(schema.legalNoticeEmailOptOuts)
    .where(eq(schema.legalNoticeEmailOptOuts.userId, userId))
    .limit(1)

  return optOut ?? null
}

export async function addLegalNoticeOptOut(
  context: FeatureAdminContext,
  input: LegalNoticeOptOutInput,
) {
  assertAdminInterface(context)
  await requireExistingUser(context.db, input.userId)

  if (await readOptOut(context.db, input.userId)) {
    return { userId: input.userId, changed: false }
  }

  const now = resolveNow(context)

  await context.db.batch([
    context.db.insert(schema.legalNoticeEmailOptOuts).values({
      userId: input.userId,
      source: 'admin',
      createdBy: context.actor.userId,
      createdAt: now,
    }),
    buildAuditInsert(context, {
      action: 'legal-notice-opt-out.add',
      flag: null,
      targetUserId: input.userId,
      before: null,
      after: { userId: input.userId, source: 'admin' },
    }),
  ])

  logLegalAdmin(context, {
    action: 'legal-notice-opt-out.add',
    targetUserId: input.userId,
  })

  return { userId: input.userId, changed: true }
}

export async function removeLegalNoticeOptOut(
  context: FeatureAdminContext,
  userId: number,
) {
  assertAdminInterface(context)

  const optOut = await readOptOut(context.db, userId)

  if (!optOut) {
    throwAdminError(404, 'Opt-out not found', 'opt_out_not_found')
  }

  await context.db.batch([
    context.db
      .delete(schema.legalNoticeEmailOptOuts)
      .where(eq(schema.legalNoticeEmailOptOuts.id, optOut.id)),
    buildAuditInsert(context, {
      action: 'legal-notice-opt-out.remove',
      flag: null,
      targetUserId: userId,
      before: { userId, source: optOut.source },
      after: null,
    }),
  ])

  logLegalAdmin(context, {
    action: 'legal-notice-opt-out.remove',
    targetUserId: userId,
  })

  return { userId, changed: true }
}
