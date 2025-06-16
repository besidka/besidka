export default {
  id: 'anthropic',
  name: 'Anthropic',
  models: [
    {
      id: 'claude-3-haiku-latest',
      name: 'Claude Haiku 3',
      description: 'The fastest model. Intelligence at blazing speeds.',
      contextLength: 200_000,
      maxOutputTokens: 8_192,
      price: {
        tokens: 1_000_000,
        input: '$0.25',
        output: '$1.25',
      },
      modalities: {
        input: ['text', 'image', 'video', 'audio'],
        output: ['text'],
      },
      tools: ['web_search'],
    },
  ],
}
