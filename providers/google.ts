export default {
  id: 'google',
  name: 'Google AI Studio',
  models: [
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      tools: ['web_search'],
    },
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      tools: ['web_search'],
    },
    {
      id: 'gemini-2.5-flash-lite-preview-06-17',
      default: true,
      name: 'Gemini 2.5 Flash-Lite',
      tools: ['web_search'],
    },
    {
      id: 'gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
      tools: ['web_search'],
    },
    {
      id: 'gemini-2.0-flash-lite',
      name: 'Gemini 2.0 Flash-Lite',
      description: 'Best for cost-efficient performance',
      contextLength: 1_000_000,
      maxOutputTokens: 8_000,
      price: {
        tokens: 1_000_000,
        input: '$0.075',
        output: '$0.30',
      },
      modalities: {
        input: ['text', 'image', 'video', 'audio'],
        output: ['text'],
      },
      tools: ['web_search'],
    },
  ],
}
