export default defineI18nLocale(() => ({
  cookieConsent: {
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
    },
  },
}))
