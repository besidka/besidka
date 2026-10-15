import type { CuratedProvider } from './merge'

export default {
  id: 'deepseek',
  name: 'DeepSeek',
  models: [
    {
      id: 'deepseek-flash',
      tools: [],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'high'],
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'deepseek-v4-pro',
      tools: [],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'high'],
      },
      price: {
        tokens: 1_000_000,
      },
    },
  ],
} satisfies CuratedProvider
