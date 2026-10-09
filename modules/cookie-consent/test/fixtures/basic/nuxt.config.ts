export default defineNuxtConfig({
  future: {
    compatibilityVersion: 5,
  },
  modules: ['../../../src/module'],
  cookieConsent: {
    categories: [
      {
        id: 'necessary',
        required: true,
        entries: [
          { id: 'consent', name: 'cookies_consent', type: 'cookie' },
          { id: 'session', name: 'session_token', type: 'cookie' },
          {
            id: 'chatInputBackup',
            name: 'chat_input_backup',
            type: 'localStorage',
          },
        ],
      },
      {
        id: 'preferences',
        entries: [
          { id: 'model', name: 'model', type: 'localStorage' },
        ],
      },
      { id: 'analytics', entries: [] },
      { id: 'marketing', entries: [] },
    ],
  },
})
