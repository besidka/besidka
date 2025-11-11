export default {
  id: 'google',
  name: 'Google AI Studio',
  models: [
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      price: {
        tokens: 1_000_000,
        input: 'from $1.25',
        output: 'from $10.00',
      },
      tools: ['web_search'],
      reasoning: true,
    },
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      price: {
        tokens: 1_000_000,
        input: '$0.30',
        output: '$2.50',
      },
      tools: ['web_search'],
      reasoning: true,
    },
    {
      id: 'gemini-2.5-flash-lite',
      default: true,
      name: 'Gemini 2.5 Flash-Lite',
      price: {
        tokens: 1_000_000,
        input: '$0.10',
        output: '$0.40',
      },
      tools: ['web_search'],
      reasoning: true,
    },
    {
      id: 'gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
      price: {
        tokens: 1_000_000,
        input: '$0.10',
        output: '$0.40',
      },
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
