export default {
  id: 'google',
  name: 'Google AI Studio',
  models: [
    {
      id: 'gemini-3.1-pro-preview',
      name: 'Gemini 3.1 Pro',
      price: {
        tokens: 1_000_000,
        input: 'from $2.00',
        output: 'from $12.00',
      },
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'high'],
      },
    },
    {
      id: 'gemini-3-pro-preview',
      name: 'Gemini 3 Pro',
      price: {
        tokens: 1_000_000,
        input: 'from $2.00',
        output: 'from $12.00',
      },
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'high'],
      },
    },
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      price: {
        tokens: 1_000_000,
        input: 'from $1.25',
        output: 'from $10.00',
      },
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gemini-3-flash-preview',
      name: 'Gemini 3 Flash',
      price: {
        tokens: 1_000_000,
        input: '$0.50',
        output: '$3.00',
      },
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
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
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
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
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
  ],
}
