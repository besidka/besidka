import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as securityEmails from '~~/server/utils/account/security-emails'

const POLICY_PHRASE_BY_SENDER: Record<string, string> = {
  sendPasswordChangedEmail: 'password was changed',
  sendSignInMethodConnectedEmail: 'sign-in method was connected',
  sendSignInMethodDisconnectedEmail: 'connected or disconnected',
  sendTwoFactorEnabledEmail: 'two-factor authentication was turned on or off',
  sendTwoFactorDisabledEmail: 'turned on or off',
  sendEmailChangedEmail: 'account email was changed',
  sendTwoFactorBackupCodesRegeneratedEmail: 'backup codes were regenerated',
  sendPasskeyAddedEmail: 'passkey was added or removed',
  sendPasskeyRemovedEmail: 'added or removed',
  sendOAuthAppConnectedEmail: 'app was connected',
}

const ART30_KEYWORD_BY_SENDER: Record<string, string> = {
  sendPasswordChangedEmail: 'password changed',
  sendSignInMethodConnectedEmail: 'sign-in method connected',
  sendSignInMethodDisconnectedEmail: 'connected or disconnected',
  sendTwoFactorEnabledEmail: '2FA on or off',
  sendTwoFactorDisabledEmail: 'on or off',
  sendEmailChangedEmail: 'account email changed',
  sendTwoFactorBackupCodesRegeneratedEmail: 'backup codes regenerated',
  sendPasskeyAddedEmail: 'passkey added or removed',
  sendPasskeyRemovedEmail: 'added or removed',
  sendOAuthAppConnectedEmail: 'app connected (oauth)',
}

const NEW_EMAIL_HINT = 'add the new email to the Privacy Policy '
  + '(\'Email I send you\'), docs/legal/art30-record.md row 20 and '
  + 'docs/email.md, then add it here'

function readRepositoryFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf-8')
}

function readPolicyEmailSection(): string {
  const source = readRepositoryFile('content/legal/privacy-policy.md')
  const start = source.indexOf('## Email I send you')
  const end = source.indexOf('\n## ', start + 1)

  return source.slice(start, end === -1 ? undefined : end)
}

function readArt30Row20(): string {
  const row = readRepositoryFile('docs/legal/art30-record.md')
    .split('\n')
    .find((line) => {
      return line.startsWith('| 20 |')
    })

  return row ?? ''
}

function listSenders(): string[] {
  return Object.keys(securityEmails)
    .filter((name) => {
      return /^send\w+Email$/.test(name)
    })
    .sort()
}

describe('account email lists stay in step with the senders', () => {
  it('registers every security-email sender in this spec', () => {
    expect(listSenders(), NEW_EMAIL_HINT).toEqual(
      Object.keys(POLICY_PHRASE_BY_SENDER).sort(),
    )
    expect(Object.keys(ART30_KEYWORD_BY_SENDER).sort(), NEW_EMAIL_HINT)
      .toEqual(listSenders())
  })

  it('finds the Privacy Policy email section', () => {
    expect(readPolicyEmailSection()).toContain('Security notices')
  })

  it.each(Object.entries(POLICY_PHRASE_BY_SENDER))(
    'lists %s in the Privacy Policy email section',
    (sender, phrase) => {
      expect(
        readPolicyEmailSection().toLowerCase(),
        `${sender}: ${NEW_EMAIL_HINT}`,
      ).toContain(phrase.toLowerCase())
    },
  )

  it('finds row 20 in the Art. 30 record', () => {
    expect(readArt30Row20()).toContain('Transactional email')
  })

  it.each(Object.entries(ART30_KEYWORD_BY_SENDER))(
    'lists %s in Art. 30 row 20',
    (sender, keyword) => {
      expect(
        readArt30Row20().toLowerCase(),
        `${sender}: ${NEW_EMAIL_HINT}`,
      ).toContain(keyword.toLowerCase())
    },
  )
})
