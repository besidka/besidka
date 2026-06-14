export default defineI18nLocale(() => ({
  cookieConsent: {
    title: 'Cookie Consent',
    description:
      'We use cookies and similar technologies to improve your experience, and '
      + 'analyse traffic. You can choose which '
      + 'categories to allow.',
    close: 'Close',
    currentState: 'Your current state',
    details: {
      show: 'Show details',
      hide: 'Hide details',
      date: 'Consent date',
      id: 'Your consent ID',
    },
    actions: {
      allowAll: 'Allow all',
      allowSelected: 'Allow selected',
      withdraw: 'Withdraw consent',
      customize: 'Customize',
      change: 'Change preferences',
    },
    categories: {
      necessary: {
        title: 'Strictly necessary',
        description:
          'These cookies are required for the website to function and '
          + 'cannot be disabled. They are set in response to actions you '
          + 'take, such as setting your privacy preferences or logging in.',
      },
      preferences: {
        title: 'Preferences',
        description:
          'These cookies allow the website to remember choices you make, '
          + 'such as your language or region, and provide enhanced, more '
          + 'personalised features.',
      },
      analytics: {
        title: 'Analytics',
        description:
          'These cookies help us understand how visitors interact with the '
          + 'website by collecting and reporting information anonymously. '
          + 'They allow us to improve our service over time.',
      },
      marketing: {
        title: 'Marketing',
        description:
          'These cookies are used to track visitors across websites to '
          + 'display relevant advertisements. They help us measure the '
          + 'effectiveness of our marketing campaigns.',
      },
    },
  },
}))
