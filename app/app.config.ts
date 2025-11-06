export default defineAppConfig({
  siteName: 'Besidka — AI Chat, Bring Your API Keys and Pay for What You Use',
  description: 'Your digital besidka for all AI chats. Connect to any LLM using your API key. Open-source, private, and community-driven.',
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
