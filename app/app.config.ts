export default defineAppConfig({
  siteName: 'Besidka',
  description: 'Besidka is an open-source, self-hostable AI chat app. Connect any supported LLM with your own API key and pay the provider directly.',
  themeColor: {
    light: '#fde4f1',
    // when in dark mode, but need light theme color
    // but not too bright
    // because iOS in system dark mode will replace it with black automatically
    // if there is not enough contrast
    lightForDark: '#834f68',
    dark: '#4b283c',
  },
  messages: {
    autoRemove: true,
    autoRemoveTimeout: 10000,
  },
})
