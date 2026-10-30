export type AccountEmailCategory
  = | 'address-and-password'
    | 'account-deletion'
    | 'security-notice'
    | 'legal-notice'

export interface AccountEmail {
  id: string
  category: AccountEmailCategory
  policyText: string
}

export interface AccountEmailListItem {
  category: AccountEmailCategory
  label: string
  lead: string
  body: string
  text: string
}

interface CategoryPresentation {
  label: string
  lead: string
  conjunction: 'and' | 'or'
}

const CATEGORY_PRESENTATION: Record<
  AccountEmailCategory,
  CategoryPresentation
> = {
  'address-and-password': {
    label: 'Address and password:',
    lead: '',
    conjunction: 'and',
  },
  'account-deletion': {
    label: 'Account deletion:',
    lead: '',
    conjunction: 'and',
  },
  'security-notice': {
    label: 'Security notices',
    lead: ', when something on your account changes:',
    conjunction: 'or',
  },
  'legal-notice': {
    label: 'Legal notices:',
    lead: '',
    conjunction: 'and',
  },
}

export const ACCOUNT_EMAILS = [
  {
    id: 'email-verification',
    category: 'address-and-password',
    policyText: 'email address verification',
  },
  {
    id: 'password-reset',
    category: 'address-and-password',
    policyText: 'password reset',
  },
  {
    id: 'email-change-confirmation',
    category: 'address-and-password',
    policyText: 'confirmation of a new email address',
  },
  {
    id: 'account-deletion-confirmation',
    category: 'account-deletion',
    policyText: 'a confirmation link when you ask to delete your account',
  },
  {
    id: 'password-changed',
    category: 'security-notice',
    policyText: 'your password was changed',
  },
  {
    id: 'sign-in-method-connected',
    category: 'security-notice',
    policyText: 'a sign-in method was connected or disconnected',
  },
  {
    id: 'sign-in-method-disconnected',
    category: 'security-notice',
    policyText: 'a sign-in method was connected or disconnected',
  },
  {
    id: 'two-factor-enabled',
    category: 'security-notice',
    policyText: 'two-factor authentication was turned on or off',
  },
  {
    id: 'two-factor-disabled',
    category: 'security-notice',
    policyText: 'two-factor authentication was turned on or off',
  },
  {
    id: 'backup-codes-regenerated',
    category: 'security-notice',
    policyText: 'backup codes were regenerated',
  },
  {
    id: 'account-email-changed',
    category: 'security-notice',
    policyText: 'your account email was changed',
  },
  {
    id: 'passkey-added',
    category: 'security-notice',
    policyText: 'a passkey was added or removed',
  },
  {
    id: 'passkey-removed',
    category: 'security-notice',
    policyText: 'a passkey was added or removed',
  },
  {
    id: 'oauth-app-connected',
    category: 'security-notice',
    policyText: 'an app was connected to your account',
  },
  {
    id: 'legal-change-notice',
    category: 'legal-notice',
    policyText: 'a notice of a significant change to the Privacy Policy, '
      + 'the Terms of Use or the Cookie Policy, sent to every account with a '
      + 'verified email address that exists when the notice is published (if '
      + 'you sign up after that, you agree to the new text). The notice is '
      + 'published on the page and in the app first, at least 30 days before '
      + 'the change takes effect (14 days if the law or security requires '
      + 'it), and emails go out from then on, a limited number a day, so '
      + 'yours can arrive a few days after publication',
  },
] as const satisfies readonly AccountEmail[]

export type AccountEmailId = typeof ACCOUNT_EMAILS[number]['id']

function joinPhrases(
  phrases: string[],
  conjunction: CategoryPresentation['conjunction'],
): string {
  if (phrases.length <= 1) {
    return phrases.join('')
  }

  const leading = phrases.slice(0, -1)
  const last = phrases[phrases.length - 1]

  if (phrases.length === 2) {
    return `${leading[0]} ${conjunction} ${last}`
  }

  const separator = conjunction === 'or' ? ', or ' : ' and '

  return `${leading.join(', ')}${separator}${last}`
}

/**
 * Builds the items of the Privacy Policy "Email I send you" list from the
 * registry: one item per category that has entries, identical policy texts
 * collapsed into the first occurrence.
 */
export function buildAccountEmailListItems(
  emails: readonly AccountEmail[] = ACCOUNT_EMAILS,
): AccountEmailListItem[] {
  const categories = Object.keys(
    CATEGORY_PRESENTATION,
  ) as AccountEmailCategory[]

  return categories.flatMap((category) => {
    const phrases = [
      ...new Set(
        emails
          .filter((email) => {
            return email.category === category
          })
          .map((email) => {
            return email.policyText
          }),
      ),
    ]

    if (phrases.length === 0) {
      return []
    }

    const { label, lead, conjunction } = CATEGORY_PRESENTATION[category]
    const body = `${joinPhrases(phrases, conjunction)}.`

    return [{ category, label, lead, body, text: `${label}${lead} ${body}` }]
  })
}

export function buildAccountEmailListMarkdown(
  emails: readonly AccountEmail[] = ACCOUNT_EMAILS,
): string {
  return buildAccountEmailListItems(emails)
    .map((item, index) => {
      return `${index + 1}. **${item.label}**${item.lead} ${item.body}`
    })
    .join('\n')
}
