export default defineNuxtConfig({
  future: {
    compatibilityVersion: 5,
  },
  modules: ['../src/module'],
  cookieConsent: {
    categories: [
      {
        id: 'necessary',
        required: true,
        entries: [
          { id: 'consent', name: 'cookies_consent', type: 'cookie' },
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
