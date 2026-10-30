import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_EMAILS,
  buildAccountEmailListItems,
  buildAccountEmailListMarkdown,
} from '#shared/utils/account-emails'
import type { AccountEmailId } from '#shared/utils/account-emails'
import * as securityEmails from '~~/server/utils/account/security-emails'
import * as legalNoticeSender from '~~/server/utils/legal/notice-sender'

const SECURITY_NOTICE_ID_BY_SENDER: Record<string, AccountEmailId> = {
  sendPasswordChangedEmail: 'password-changed',
  sendSignInMethodConnectedEmail: 'sign-in-method-connected',
  sendSignInMethodDisconnectedEmail: 'sign-in-method-disconnected',
  sendTwoFactorEnabledEmail: 'two-factor-enabled',
  sendTwoFactorDisabledEmail: 'two-factor-disabled',
  sendTwoFactorBackupCodesRegeneratedEmail: 'backup-codes-regenerated',
  sendEmailChangedEmail: 'account-email-changed',
  sendPasskeyAddedEmail: 'passkey-added',
  sendPasskeyRemovedEmail: 'passkey-removed',
  sendOAuthAppConnectedEmail: 'oauth-app-connected',
}

const LEGAL_NOTICE_ID_BY_SENDER: Record<string, AccountEmailId> = {
  sendLegalNoticeEmail: 'legal-change-notice',
}

const NEW_EMAIL_HINT = 'add an entry to shared/utils/account-emails.ts'

function readRepositoryFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf-8')
}

function readPolicyEmailSection(): string {
  const source = readRepositoryFile('content/legal/privacy-policy.md')
  const start = source.indexOf('## Email I send you')
  const end = source.indexOf('\n## ', start + 1)

  return source.slice(start, end === -1 ? undefined : end)
}

function listSenders(): string[] {
  return Object.keys(securityEmails)
    .filter((name) => {
      return /^send\w+Email$/.test(name)
    })
    .sort()
}

function listLegalSenders(): string[] {
  return Object.keys(legalNoticeSender)
    .filter((name) => {
      return /^send\w+Email$/.test(name)
    })
    .sort()
}

function listIdsOfCategory(category: string): string[] {
  return ACCOUNT_EMAILS
    .filter((email) => {
      return email.category === category
    })
    .map((email) => {
      return email.id
    })
    .sort()
}

function listSecurityNoticeIds(): string[] {
  return listIdsOfCategory('security-notice')
}

function listLegalNoticeIds(): string[] {
  return listIdsOfCategory('legal-notice')
}

describe('account email registry stays in step with the senders', () => {
  it('maps every security-email sender to a registry entry', () => {
    expect(listSenders(), NEW_EMAIL_HINT).toEqual(
      Object.keys(SECURITY_NOTICE_ID_BY_SENDER).sort(),
    )

    for (const [sender, id] of Object.entries(SECURITY_NOTICE_ID_BY_SENDER)) {
      expect(listSecurityNoticeIds(), `${sender}: ${NEW_EMAIL_HINT}`)
        .toContain(id)
    }
  })

  it('has no security-notice entry without a sender', () => {
    expect(listSecurityNoticeIds(), NEW_EMAIL_HINT).toEqual(
      Object.values(SECURITY_NOTICE_ID_BY_SENDER).sort(),
    )
  })

  it('maps every legal-notice sender to a registry entry', () => {
    expect(listLegalSenders(), NEW_EMAIL_HINT).toEqual(
      Object.keys(LEGAL_NOTICE_ID_BY_SENDER).sort(),
    )
    expect(listLegalNoticeIds(), NEW_EMAIL_HINT).toEqual(
      Object.values(LEGAL_NOTICE_ID_BY_SENDER).sort(),
    )
  })

  it('uses unique ids', () => {
    const ids = ACCOUNT_EMAILS.map((email) => {
      return email.id
    })

    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('buildAccountEmailListItems', () => {
  it('produces exactly the four items the policy publishes', () => {
    expect(buildAccountEmailListItems().map((item) => {
      return item.text
    })).toEqual([
      'Address and password: email address verification, password reset '
      + 'and confirmation of a new email address.',
      'Account deletion: a confirmation link when you ask to delete your '
      + 'account.',
      'Security notices, when something on your account changes: your '
      + 'password was changed, a sign-in method was connected or '
      + 'disconnected, two-factor authentication was turned on or off, '
      + 'backup codes were regenerated, your account email was changed, a '
      + 'passkey was added or removed, or an app was connected to your '
      + 'account.',
      'Legal notices: a notice of a significant change to the Privacy '
      + 'Policy, the Terms of Use or the Cookie Policy, sent to every '
      + 'account with a verified email address that exists when the notice '
      + 'is published (if you sign up after that, you agree to the new '
      + 'text). The notice is published on the page and in the app first, '
      + 'at least 30 days before the change takes effect (14 days if the '
      + 'law or security requires it), and emails go out from then on, a '
      + 'limited number a day, so yours can arrive a few days after '
      + 'publication.',
    ])
  })

  it('collapses identical policy texts and keeps first-seen order', () => {
    const items = buildAccountEmailListItems([
      { id: 'one', category: 'security-notice', policyText: 'a was changed' },
      { id: 'two', category: 'security-notice', policyText: 'b was changed' },
      { id: 'three', category: 'security-notice', policyText: 'a was changed' },
    ])

    expect(items).toHaveLength(1)
    expect(items[0]?.body).toBe('a was changed or b was changed.')
  })

  it('skips categories that have no entries', () => {
    expect(buildAccountEmailListItems([])).toEqual([])
  })

  it('renders the same items as a markdown list', () => {
    expect(buildAccountEmailListMarkdown().split('\n')).toEqual([
      '1. **Address and password:** email address verification, password '
      + 'reset and confirmation of a new email address.',
      '2. **Account deletion:** a confirmation link when you ask to delete '
      + 'your account.',
      expect.stringMatching(
        /^3\. \*\*Security notices\*\*, when something on your account /,
      ),
      expect.stringMatching(/^4\. \*\*Legal notices:\*\* a notice of a /),
    ])
  })
})

describe('Privacy Policy email section', () => {
  it('uses the block component instead of a hand-written list', () => {
    const section = readPolicyEmailSection()

    expect(section).toContain('## Email I send you')
    expect(section).toContain('::account-email-list')
    expect(section).not.toContain('Security notices')
    expect(section).not.toContain('Address and password')
  })

  it('keeps the transactional-only and no-marketing sentences', () => {
    const section = readPolicyEmailSection()

    expect(section).toContain('I send only transactional email')
    expect(section).toContain('**I never send marketing email**')
  })

  it('says a legal notice has no promotion and no unsubscribe link', () => {
    const section = readPolicyEmailSection()

    expect(section).toContain('A legal notice is a notice about a change to these terms')
    expect(section).toContain('no unsubscribe link')
  })
})
