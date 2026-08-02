import type { CuratedProvider } from './merge'

export default {
  id: 'anthropic',
  name: 'Anthropic',
  models: [
    {
      id: 'claude-opus-5',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'claude-sonnet-5',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'claude-haiku-4-5',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
  ],
} satisfies CuratedProvider
