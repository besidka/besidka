import type { CuratedProvider } from './merge'

export default {
  id: 'xai',
  name: 'xAI',
  models: [
    {
      id: 'grok-4.20-0309-non-reasoning',
      tools: ['web_search'],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'grok-4.20-0309-reasoning',
      tools: ['web_search'],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'grok-4.5',
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
      price: {
        tokens: 1_000_000,
      },
    },
  ],
} satisfies CuratedProvider
