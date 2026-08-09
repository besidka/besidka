import type { CuratedProvider } from './merge'

export default {
  id: 'deepseek',
  name: 'DeepSeek',
  models: [
    {
      id: 'deepseek-chat',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'deepseek-reasoner',
      tools: [],
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
