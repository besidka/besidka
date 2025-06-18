export default {
  id: 'google',
  name: 'Google',
  models: [
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
      tools: [],
    },
  ],
}
