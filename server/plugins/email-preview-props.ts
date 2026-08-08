const actionEmailVariants = [
  {
    preview: 'Reset your Besidka account password',
    heading: 'Reset your password',
    intro: 'We received a request to reset your Besidka account password.',
    ctaLabel: 'Reset password',
    url: 'https://besidka.com/api/auth/reset-password/preview-token',
    footnote: 'If you didn\'t request this, you can safely ignore this '
      + 'email.',
  },
  {
    preview: 'Verify your Besidka email address',
    heading: 'Verify your email address',
    intro: 'Confirm this is your email address to finish setting up your '
      + 'Besidka account.',
    ctaLabel: 'Verify email',
    url: 'https://besidka.com/api/auth/verify-email/preview-token',
    footnote: 'If you didn\'t create a Besidka account, you can safely '
      + 'ignore this email.',
  },
  {
    preview: 'Confirm your new Besidka email address',
    heading: 'Confirm your new email address',
    intro: 'We received a request to change your Besidka account email '
      + 'address to new.address@example.com.',
    ctaLabel: 'Confirm change',
    url: 'https://besidka.com/api/auth/change-email/preview-token',
    footnote: 'If you didn\'t request this, you can safely ignore this '
      + 'email.',
  },
  {
    preview: 'Confirm deleting your Besidka account',
    heading: 'Confirm deleting your account',
    intro: 'We received a request to permanently delete your Besidka '
      + 'account.',
    ctaLabel: 'Delete my account',
    url: 'https://besidka.com/api/auth/delete-user/preview-token',
    footnote: 'This permanently deletes your account and all associated '
      + 'data - chats, files, and settings - and cannot be undone.',
  },
]

const noticeEmailVariants = [
  {
    preview: 'Your password was changed',
    heading: 'Your password was changed',
    body: 'Your Besidka account password was just changed. If this was '
      + 'not you, reset your password immediately and review your '
      + 'account’s active sessions.',
  },
  {
    preview: 'New sign-in method connected',
    heading: 'New sign-in method connected',
    body: 'Google was just connected as a sign-in method on your Besidka '
      + 'account. If this was not you, disconnect it from your account '
      + 'security settings and change your password.',
  },
  {
    preview: 'Sign-in method disconnected',
    heading: 'Sign-in method disconnected',
    body: 'GitHub was just disconnected as a sign-in method from your '
      + 'Besidka account. If this was not you, contact support '
      + 'immediately.',
  },
  {
    preview: 'Two-factor authentication turned on',
    heading: 'Two-factor authentication turned on',
    body: 'Two-factor authentication was just turned on for your Besidka '
      + 'account. If this was not you, turn it off from your account '
      + 'security settings and change your password immediately.',
  },
  {
    preview: 'Two-factor authentication turned off',
    heading: 'Two-factor authentication turned off',
    body: 'Two-factor authentication was just turned off for your '
      + 'Besidka account. If this was not you, turn it back on from your '
      + 'account security settings and change your password immediately.',
  },
  {
    preview: 'Your account email address was changed',
    heading: 'Your account email address was changed',
    body: 'Your Besidka account email address was just changed to '
      + 'new.address@example.com. If this was not you, contact support '
      + 'immediately.',
  },
  {
    preview: 'Two-factor backup codes regenerated',
    heading: 'Two-factor backup codes regenerated',
    body: 'Your two-factor authentication backup codes were just '
      + 'regenerated on your Besidka account, invalidating every previous '
      + 'code. If this was not you, turn off two-factor authentication '
      + 'from your account security settings and change your password '
      + 'immediately.',
  },
  {
    preview: 'New passkey added',
    heading: 'New passkey added',
    body: 'A new passkey was just added to your Besidka account. If this '
      + 'was not you, remove it from your account security settings and '
      + 'change your password immediately.',
  },
  {
    preview: 'Passkey removed',
    heading: 'Passkey removed',
    body: 'A passkey was just removed from your Besidka account. If this '
      + 'was not you, review your account security settings and change '
      + 'your password immediately.',
  },
]

const previewVariantsByTemplate: Record<string, unknown[]> = {
  ActionEmail: actionEmailVariants,
  NoticeEmail: noticeEmailVariants,
}

const cursorByTemplate: Record<string, number> = {}

export default defineNitroPlugin((nitroApp) => {
  if (!import.meta.dev) {
    return
  }

  nitroApp.hooks.hook('nuxt-email-renderer:devtools:resolveProps', (context) => {
    const variants = previewVariantsByTemplate[context.templateName]

    if (!variants) {
      return
    }

    const cursor = cursorByTemplate[context.templateName] ?? 0

    cursorByTemplate[context.templateName] = (cursor + 1) % variants.length

    context.props = {
      ...context.props,
      ...variants[cursor],
    }
  })
})
