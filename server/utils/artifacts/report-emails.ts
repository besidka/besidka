import type {
  ArtifactReportPriority,
  ArtifactReportReason,
} from '#shared/utils/artifacts'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { ARTIFACT_REPORT_REASON_LABELS } from '#shared/utils/artifacts'
import {
  renderTemplateEmail,
  sendRenderedEmail,
} from '~~/server/utils/email-template'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { resolveServerLogger } from '~~/server/utils/files/logger'

export const ARTIFACT_EMAIL_SIGNATURE = 'Serhii Chernenko, Besidka'
export const ARTIFACT_TERMS_PROHIBITED_URL_PATH
  = '/terms-of-use#what-you-may-not-do'
export const ARTIFACT_SHARING_WITHDRAWN_TEXT = 'Link sharing is also turned '
  + 'off for your account: you cannot create new public links to artifacts '
  + 'until a person reviews this decision again.'

export type ArtifactEmailKind
  = | 'report-mailbox'
    | 'report-receipt'
    | 'report-decision'
    | 'statement-of-reasons'

export interface ArtifactReportLocation {
  kind: 'artifact-share' | 'shared-chat'
  artifactId: string
  shareId: string | null
  chatShareId: string | null
}

export type ArtifactDecisionOutcome
  = | 'link-disabled'
    | 'artifact-disabled'
    | 'no-action'

interface ArtifactEmailInput {
  kind: ArtifactEmailKind
  to: string
  subject: string
  heading: string
  paragraphs: string[]
  logger?: LoggerLike
}

function privacyMailbox(): string {
  return String(useRuntimeConfig().public.privacyEmail ?? '')
}

export function formatArtifactEmailDate(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/**
 * Names the reported content to the reporter by reference id only. The
 * artifact title is never included: a reporter could otherwise make
 * Besidka mail text of their choice (a title they wrote and shared) to an
 * address they typed.
 */
export function describeArtifactReportLocation(
  location: ArtifactReportLocation,
): string {
  if (location.kind === 'shared-chat') {
    return `an artifact in a shared chat (reference ${location.artifactId})`
  }

  return `a shared artifact (reference ${location.shareId})`
}

/**
 * Sends one artifact report email as a `NoticeEmail` with a plain-text part
 * that keeps the paragraphs apart. Replies go to the privacy mailbox. A
 * failure is logged with the email kind only and never thrown, so a report
 * or a decision never fails on email. Callers must not pass a share token or
 * an IP address in any field.
 */
export async function sendArtifactEmail(
  input: ArtifactEmailInput,
): Promise<boolean> {
  const logger = resolveServerLogger(input.logger)

  if (!input.to) {
    logger.set({
      attributes: {
        artifacts: { email: { kind: input.kind, skipped: 'no-recipient' } },
      },
    })

    return false
  }

  try {
    const rendered = await renderTemplateEmail({
      template: 'NoticeEmail',
      props: {
        preview: input.subject,
        heading: input.heading,
        body: input.paragraphs.join('\n\n'),
      },
    })

    await sendRenderedEmail({
      to: input.to,
      subject: input.subject,
      html: rendered.html,
      text: [input.heading, ...input.paragraphs].join('\n\n'),
      replyTo: privacyMailbox() || undefined,
    })

    return true
  } catch (exception) {
    logger.set({
      attributes: {
        artifacts: {
          email: { kind: input.kind, error: exceptionMessage(exception) },
        },
      },
    })

    return false
  }
}

export async function sendArtifactReportMailboxEmail(input: {
  reportId: number
  reason: ArtifactReportReason
  priority: ArtifactReportPriority
  location: ArtifactReportLocation
  reporterUserId: number | null
  reporterName: string | null
  reporterEmail: string | null
  details: string
  createdAt: Date
  logger?: LoggerLike
}): Promise<boolean> {
  const prefix = input.priority === 'urgent' ? '[URGENT] ' : ''
  const subject = `${prefix}Artifact report #${input.reportId}: `
    + ARTIFACT_REPORT_REASON_LABELS[input.reason]
  const reporter = [
    input.reporterName ?? 'no name given',
    input.reporterEmail ?? 'no email given',
    input.reporterUserId === null
      ? 'signed out'
      : `signed in as user ${input.reporterUserId}`,
  ].join(', ')

  return await sendArtifactEmail({
    kind: 'report-mailbox',
    to: privacyMailbox(),
    subject,
    heading: subject,
    paragraphs: [
      `Report ${input.reportId}, received ${
        formatArtifactEmailDate(input.createdAt)
      }.`,
      `Reason: ${input.reason}. Priority: ${input.priority}.`,
      `Artifact: ${input.location.artifactId}. Share link: ${
        input.location.shareId ?? 'none'
      }. Shared chat: ${input.location.chatShareId ?? 'none'}.`,
      `Reporter: ${reporter}.`,
      `Details:\n${input.details}`,
      'Review and decide in Admin → Artifact reports.',
    ],
    logger: input.logger,
  })
}

export async function sendArtifactReportReceiptEmail(input: {
  to: string
  reason: ArtifactReportReason
  location: ArtifactReportLocation
  createdAt: Date
  logger?: LoggerLike
}): Promise<boolean> {
  const subject = 'Your report about a shared artifact was received'

  return await sendArtifactEmail({
    kind: 'report-receipt',
    to: input.to,
    subject,
    heading: subject,
    paragraphs: [
      `Thank you for your report about ${
        describeArtifactReportLocation(input.location)
      }, received on ${formatArtifactEmailDate(input.createdAt)}, in the `
      + `category "${ARTIFACT_REPORT_REASON_LABELS[input.reason]}". A person `
      + 'will review it and decide without undue delay whether the content '
      + 'stays up, is removed or is disabled. I will tell you the decision '
      + 'and how you can challenge it. This is an automatic confirmation; '
      + 'you can reply to this email to add information.',
      ARTIFACT_EMAIL_SIGNATURE,
    ],
    logger: input.logger,
  })
}

function describeDecision(outcome: ArtifactDecisionOutcome): string {
  switch (outcome) {
    case 'link-disabled':
      return 'the public link was disabled'
    case 'artifact-disabled':
      return 'access to the artifact was disabled on every link and in '
        + 'shared chats'
    default:
      return 'no action was taken'
  }
}

export async function sendArtifactReportDecisionEmail(input: {
  to: string
  reportedAt: Date
  decidedAt: Date
  location: ArtifactReportLocation
  outcome: ArtifactDecisionOutcome
  statement: string
  logger?: LoggerLike
}): Promise<boolean> {
  const subject = 'Decision on your report about a shared artifact'

  return await sendArtifactEmail({
    kind: 'report-decision',
    to: input.to,
    subject,
    heading: subject,
    paragraphs: [
      `I reviewed your report of ${formatArtifactEmailDate(input.reportedAt)} `
      + `about ${describeArtifactReportLocation(input.location)}.`,
      `Decision: ${describeDecision(input.outcome)}, on `
      + `${formatArtifactEmailDate(input.decidedAt)}.`,
      `Reason: ${input.statement}`,
      'The decision was made by a person. No automated means were used to '
      + 'decide.',
      'If you disagree, reply to this email and a person will look at it '
      + 'again. You can also go to a court.',
      ARTIFACT_EMAIL_SIGNATURE,
    ],
    logger: input.logger,
  })
}

export interface StatementOfReasonsInput {
  to: string
  artifacts: Array<{ id: string, title: string }>
  scope: 'share' | 'artifact' | 'user'
  shareId: string | null
  decidedAt: Date
  statement: string
  followedReport: boolean
  legalHoldUntil: Date | null
  logger?: LoggerLike
}

function describeTakedownScope(input: StatementOfReasonsInput): string {
  if (input.scope === 'share') {
    return `the link ${input.shareId} only`
  }

  return 'all links and the artifact in shared chats'
}

function describeTakedownSubject(input: StatementOfReasonsInput): string {
  const [first] = input.artifacts

  if (input.artifacts.length === 1 && first) {
    return `your artifact "${first.title}" (${first.id})`
  }

  return `${input.artifacts.length} of your artifacts (${
    input.artifacts.map(artifact => artifact.id).join(', ')
  })`
}

function describeRetention(
  scope: StatementOfReasonsInput['scope'],
  legalHoldUntil: Date | null,
): string {
  const state = scope === 'share'
    ? 'Only that link is disabled; the artifact itself stays in your '
    + 'library and on your other links.'
    : 'The artifact is disabled, not deleted.'

  if (!legalHoldUntil) {
    return `${state} You can still delete it.`
  }

  return `${state} It is held until `
    + `${formatArtifactEmailDate(legalHoldUntil)} because an authority `
    + 'ordered its removal or asked me to preserve it, so it cannot be '
    + 'deleted before then.'
}

/**
 * The DSA Art. 17 statement of reasons to the owner (content-incidents T3).
 * `statement` carries the facts and the ground written by the admin; the
 * email adds the scope, duration, retention, the automated-means line and
 * how to challenge the decision. The reporter is never named.
 */
export async function sendArtifactStatementOfReasonsEmail(
  input: StatementOfReasonsInput,
): Promise<boolean> {
  const restricted = input.scope === 'share'
  const [first] = input.artifacts
  const subject = input.artifacts.length === 1 && first
    ? `Your artifact "${first.title}" was ${
      restricted ? 'restricted' : 'removed'
    }`
    : 'Your artifacts were removed'
  const action = restricted
    ? `disabled the public link ${input.shareId} of`
    : 'disabled access to'
  const baseUrl = String(useRuntimeConfig().public.baseUrl ?? '')
    .replace(/\/$/, '')

  return await sendArtifactEmail({
    kind: 'statement-of-reasons',
    to: input.to,
    subject,
    heading: subject,
    paragraphs: [
      `I ${action} ${describeTakedownSubject(input)} on `
      + `${formatArtifactEmailDate(input.decidedAt)}. Scope: `
      + `${describeTakedownScope(input)}, everywhere, not only in some `
      + 'countries. Duration: until further notice. '
      + describeRetention(input.scope, input.legalHoldUntil),
      ...(input.scope === 'user' ? [ARTIFACT_SHARING_WITHDRAWN_TEXT] : []),
      `Facts and ground: ${input.statement}`,
      input.followedReport
        ? 'The decision followed a report made under the notice process.'
        : 'The decision was taken without a report under the notice process.',
      `Terms of Use: ${baseUrl}${ARTIFACT_TERMS_PROHIBITED_URL_PATH}`,
      'Automated means: none were used. The decision was made by a person.',
      'How to challenge it: reply to this email with your reasons and a '
      + 'person will look at it again. You can also go to a court.',
      ARTIFACT_EMAIL_SIGNATURE,
    ],
    logger: input.logger,
  })
}
