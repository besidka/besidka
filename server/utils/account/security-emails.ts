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
  html,
  logger,
}: {
  user: SecurityEmailUser
  subject: string
  html: string
  logger?: LoggerLike
}): Promise<void> {
  try {
    if (import.meta.dev) {
      // eslint-disable-next-line no-console
      console.log(`${subject} email for ${user.email}`)

      return
    }

    const { send: sendEmail } = useEmail()

    await sendEmail({
      to: user.email,
      subject,
      html,
      text: html,
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
    html: 'Your Besidka account password was just changed. If this was '
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
    html: `${providerLabel(providerId)} was just connected as a sign-in `
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
    html: `${providerLabel(providerId)} was just disconnected as a `
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
    html: 'Two-factor authentication was just turned on for your Besidka '
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
    html: 'Two-factor authentication was just turned off for your '
      + 'Besidka account. If this was not you, turn it back on from '
      + 'your account security settings and change your password '
      + 'immediately.',
    logger,
  })
}
