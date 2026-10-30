import type { LoggerLike } from '~~/server/utils/files/logger'
import { resolveServerLogger } from '~~/server/utils/files/logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

interface SecurityEmailUser {
  email: string
}

const providerLabels: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  credential: 'Email and password',
}

function providerLabel(providerId: string): string {
  return providerLabels[providerId] ?? providerId
}

async function sendSecurityNotificationEmail({
  user,
  subject,
  heading,
  body,
  logger,
}: {
  user: SecurityEmailUser
  subject: string
  heading: string
  body: string
  logger?: LoggerLike
}): Promise<void> {
  try {
    if (import.meta.dev) {
      // eslint-disable-next-line no-console
      console.log(`${subject} email for ${user.email}`)

      return
    }

    await sendTemplateEmail({
      to: user.email,
      subject,
      template: 'NoticeEmail',
      props: {
        preview: subject,
        heading,
        body,
      },
    })
  } catch (exception) {
    resolveServerLogger(logger).set({
      securityEmail: {
        subject,
        error: exceptionMessage(exception),
      },
    })
  }
}

export async function sendPasswordChangedEmail({
  user,
  logger,
}: {
  user: SecurityEmailUser
  logger?: LoggerLike
}): Promise<void> {
  await sendSecurityNotificationEmail({
    user,
    subject: 'Your password was changed',
    heading: 'Your password was changed',
    body: 'Your Besidka account password was just changed. If this was '
      + 'not you, reset your password immediately and review your '
      + 'account’s active sessions.',
    logger,
  })
}

export async function sendSignInMethodConnectedEmail({
  user,
  providerId,
  logger,
}: {
  user: SecurityEmailUser
  providerId: string
  logger?: LoggerLike
}): Promise<void> {
  await sendSecurityNotificationEmail({
    user,
    subject: 'New sign-in method connected',
    heading: 'New sign-in method connected',
    body: `${providerLabel(providerId)} was just connected as a sign-in `
      + 'method on your Besidka account. If this was not you, disconnect '
      + 'it from your account security settings and change your password.',
    logger,
  })
}

export async function sendSignInMethodDisconnectedEmail({
  user,
  providerId,
  logger,
}: {
  user: SecurityEmailUser
  providerId: string
  logger?: LoggerLike
}): Promise<void> {
  await sendSecurityNotificationEmail({
    user,
    subject: 'Sign-in method disconnected',
    heading: 'Sign-in method disconnected',
    body: `${providerLabel(providerId)} was just disconnected as a `
      + 'sign-in method from your Besidka account. If this was not you, '
      + 'contact support immediately.',
    logger,
  })
}

export async function sendTwoFactorEnabledEmail({
  user,
  logger,
}: {
  user: SecurityEmailUser
  logger?: LoggerLike
}): Promise<void> {
  await sendSecurityNotificationEmail({
    user,
    subject: 'Two-factor authentication turned on',
    heading: 'Two-factor authentication turned on',
    body: 'Two-factor authentication was just turned on for your Besidka '
      + 'account. If this was not you, turn it off from your account '
      + 'security settings and change your password immediately.',
    logger,
  })
}

export async function sendTwoFactorDisabledEmail({
  user,
  logger,
}: {
  user: SecurityEmailUser
  logger?: LoggerLike
}): Promise<void> {
  await sendSecurityNotificationEmail({
    user,
    subject: 'Two-factor authentication turned off',
    heading: 'Two-factor authentication turned off',
    body: 'Two-factor authentication was just turned off for your '
      + 'Besidka account. If this was not you, turn it back on from '
      + 'your account security settings and change your password '
      + 'immediately.',
    logger,
  })
}

export async function sendEmailChangedEmail({
  user,
  newEmail,
  logger,
}: {
  user: SecurityEmailUser
  newEmail: string
  logger?: LoggerLike
}): Promise<void> {
  await sendSecurityNotificationEmail({
    user,
    subject: 'Your account email address was changed',
    heading: 'Your account email address was changed',
    body: 'Your Besidka account email address was just changed to '
      + `${newEmail}. If this was not you, contact support immediately.`,
    logger,
  })
}

export async function sendTwoFactorBackupCodesRegeneratedEmail({
  user,
  logger,
}: {
  user: SecurityEmailUser
  logger?: LoggerLike
}): Promise<void> {
  await sendSecurityNotificationEmail({
    user,
    subject: 'Two-factor backup codes regenerated',
    heading: 'Two-factor backup codes regenerated',
    body: 'Your two-factor authentication backup codes were just '
      + 'regenerated on your Besidka account, invalidating every previous '
      + 'code. If this was not you, turn off two-factor authentication '
      + 'from your account security settings and change your password '
      + 'immediately.',
    logger,
  })
}

export async function sendPasskeyAddedEmail({
  user,
  logger,
}: {
  user: SecurityEmailUser
  logger?: LoggerLike
}): Promise<void> {
  await sendSecurityNotificationEmail({
    user,
    subject: 'New passkey added',
    heading: 'New passkey added',
    body: 'A new passkey was just added to your Besidka account. If this '
      + 'was not you, remove it from your account security settings and '
      + 'change your password immediately.',
    logger,
  })
}

export async function sendPasskeyRemovedEmail({
  user,
  logger,
}: {
  user: SecurityEmailUser
  logger?: LoggerLike
}): Promise<void> {
  await sendSecurityNotificationEmail({
    user,
    subject: 'Passkey removed',
    heading: 'Passkey removed',
    body: 'A passkey was just removed from your Besidka account. If this '
      + 'was not you, review your account security settings and change '
      + 'your password immediately.',
    logger,
  })
}

const oauthScopePhrases: Record<string, string> = {
  'chats:read': 'read your chats',
  'projects:read': 'read your projects',
  'memory:read': 'read your memory',
  'projects:write': 'change your projects',
  'memory:write': 'change your memory',
  'files:read': 'read your files',
  'settings:read': 'read your settings',
  'chats:write': 'change your chats',
  'files:write': 'change your files',
  'settings:write': 'change your settings',
  'data:delete': 'permanently delete your data',
  'openid': 'know who you are',
  'profile': 'see your name',
  'email': 'see your email address',
  'offline_access': 'stay connected until you disconnect it',
}

const OAUTH_APP_NAME_MAX_LENGTH = 120
const OAUTH_APP_NAME_FALLBACK = 'An app'
const OAUTH_APP_NAME_UNSAFE_CHARACTERS
  = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

export function sanitizeOAuthAppName(name: string | null | undefined): string {
  const cleaned = (name ?? '')
    .replace(OAUTH_APP_NAME_UNSAFE_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, OAUTH_APP_NAME_MAX_LENGTH)

  return cleaned || OAUTH_APP_NAME_FALLBACK
}

function describeOAuthScopes(scopes: string[]): string {
  const phrases = scopes.map((scope) => {
    return oauthScopePhrases[scope] ?? scope
  })

  return phrases.length ? phrases.join(', ') : 'no access'
}

export async function sendOAuthAppConnectedEmail({
  user,
  appName,
  scopes,
  connectedAt,
  connectedAppsUrl,
  logger,
}: {
  user: SecurityEmailUser
  appName: string | null | undefined
  scopes: string[]
  connectedAt: Date
  connectedAppsUrl: string
  logger?: LoggerLike
}): Promise<void> {
  const subject = 'A new app was connected to your Besidka account'

  try {
    if (import.meta.dev) {
      // eslint-disable-next-line no-console
      console.log(`${subject} email for ${user.email}`)

      return
    }

    await sendTemplateEmail({
      to: user.email,
      subject,
      template: 'ActionEmail',
      props: {
        preview: subject,
        heading: subject,
        intro: `${sanitizeOAuthAppName(appName)} was just connected to your `
          + `Besidka account at ${connectedAt.toUTCString()}. It chose its `
          + 'own name and Besidka has not verified it. It can: '
          + `${describeOAuthScopes(scopes)}.`,
        ctaLabel: 'Review connected apps',
        url: connectedAppsUrl,
        footnote: 'If this was not you, disconnect the app from Connected '
          + 'apps and change your password.',
      },
    })
  } catch (exception) {
    resolveServerLogger(logger).set({
      securityEmail: {
        subject,
        error: exceptionMessage(exception),
      },
    })
  }
}
