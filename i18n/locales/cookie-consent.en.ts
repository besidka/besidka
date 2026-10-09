export default defineI18nLocale(() => ({
  cookieConsent: {
    description:
      'Besidka stores only what it needs to run and, with your permission, '
      + 'your preferences on this device. No analytics or advertising '
      + 'cookies.',
    firstLayer: {
      benefit:
        'Allow preferences so Besidka remembers your theme, model, drafts '
        + 'and settings between visits on this device. Necessary cookies '
        + 'are always on.',
    },
    prompt: {
      message:
      'Remember your preferences on this device? Besidka will keep your '
      + 'theme, model, drafts and settings between visits.',
      remember: 'Remember',
      notNow: 'Not now',
    },
    policyLink: 'Cookie Policy',
    currentState: 'Your current state',
    details: {
      show: 'Show details',
      hide: 'Hide details',
      date: 'Consent date:',
      id: 'Consent ID:',
    },
    required: 'Always active',
    empty: 'We do not use cookies of this type.',
    entryDuration: 'Duration',
    entryStorage: 'Storage',
    entriesSummary: 'Cookie details ({count})',
    storageTypes: {
      cookie: 'Cookie',
      localStorage: 'Local storage',
      sessionStorage: 'Session storage',
    },
    entries: {
      'consent': {
        description:
          'Stores your cookie consent decision so the banner '
          + 'does not re-appear on every visit.',
        duration: '180 days',
      },
      'session-token': {
        description:
          'Authenticates your session with the Besidka server '
          + '(set by Better Auth).',
        duration: '7 days (session)',
      },
      'session-data': {
        description:
          'Short-lived cache of your session so each page load '
          + 'does not have to query the database (set by Better Auth).',
        duration: '5 minutes',
      },
      'dont-remember': {
        description:
          'Records that you chose not to be remembered, so the '
          + 'session ends when you close the browser (set by Better Auth).',
        duration: 'Until you close the browser',
      },
      'oauth-state': {
        description:
          'One-time value that ties a Google or GitHub sign-in '
          + 'redirect back to the request that started it (set by Better Auth).',
        duration: '5 minutes',
      },
      'two-factor': {
        description:
          'Holds the pending two-factor sign-in step between your '
          + 'password and your verification code (set by Better Auth).',
        duration: '10 minutes',
      },
      'trust-device': {
        description:
          'Lets you skip the two-factor code on this device. Set '
          + 'only if you tick the trust-this-device option (set by Better Auth).',
        duration: '30 days',
      },
      'passkey-challenge': {
        description:
          'One-time challenge used while you register or sign in '
          + 'with a passkey (set by Better Auth).',
        duration: '5 minutes',
      },
      'chat-input-backup': {
        description:
          'Holds the text of a message you typed but have not '
          + 'sent yet, so a failed send or an expired session does not lose it. '
          + 'It stays in your browser and is discarded once the message is sent.',
        duration: 'About 24 hours',
      },
      'push-endpoint': {
        description:
          'Remembers the push-notification subscription of this '
          + 'browser so it can be refreshed or removed. Written only after you '
          + 'turn notifications on.',
        duration: 'Until deleted',
      },
      'pwa-refresher-dismissed': {
        description:
          'Remembers for this tab that you dismissed the '
          + '"new version available" prompt, so it does not reappear at once.',
        duration: '30 minutes (this tab)',
      },
      'pwa-auto-refresh-applied': {
        description:
          'Stops the app from reloading itself repeatedly while '
          + 'applying an update in the background.',
        duration: '5 minutes (this tab)',
      },
      'last-login-method': {
        description:
          'Remembers which sign-in method (email, Google, GitHub) '
          + 'you last used, to pre-select it on the next visit.',
        duration: '30 days',
      },
      'color-mode': {
        description:
          'Persists your preferred colour theme (light or dark) '
          + 'across sessions.',
        duration: 'Until deleted',
      },
      'color-mode-cookie': {
        description:
          'Cookie fallback for the colour-mode preference, set by '
          + '{\'@\'}nuxtjs/color-mode when localStorage is unavailable.',
        duration: 'Until deleted',
      },
      'file-manager-view-mode': {
        description:
          'Saves whether you prefer grid or list view in the '
          + 'file manager.',
        duration: 'Until deleted',
      },
      'reasoning-expanded': {
        description:
          'Remembers whether you have expanded the reasoning '
          + 'steps panel for AI responses.',
        duration: 'Until deleted',
      },
      'reasoning-auto-hide': {
        description:
          'Stores your preference for automatically collapsing '
          + 'reasoning steps after a response loads.',
        duration: 'Until deleted',
      },
      'reasoning-level': {
        description:
          'Saves your selected reasoning effort level '
          + '(e.g. low, medium, high) for supported models.',
        duration: 'Until deleted',
      },
      'chat-input': {
        description:
          'Preserves the draft text in the chat input box '
          + 'so it is not lost on page reload.',
        duration: 'Until deleted',
      },
      'model': {
        description:
          'Remembers the AI model you last selected '
          + 'so it is pre-loaded on your next chat.',
        duration: 'Until deleted',
      },
      'plyr': {
        description:
          'Stores video-player preferences such as volume '
          + 'and playback speed (used by the Plyr player on '
          + 'the home page).',
        duration: 'Until deleted',
      },
      'sidebar-pinned': {
        description:
          'Remembers whether you pinned the sidebar open '
          + 'so it stays visible instead of revealing on hover.',
        duration: 'Until deleted',
      },
      'favorite-models': {
        description:
          'Keeps your favourite models in the model picker for '
          + 'visits when you are not signed in.',
        duration: 'Until deleted',
      },
      'favorite-gateway-models': {
        description:
          'Keeps your favourite gateway models in the model '
          + 'picker for visits when you are not signed in.',
        duration: 'Until deleted',
      },
      'web-search-tool': {
        description:
          'Remembers which web search tool you last chose for '
          + 'new chats.',
        duration: 'Until deleted',
      },
    },
  },
}))
