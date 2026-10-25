import type { CuratedProvider } from './merge'

export default {
  id: 'deepseek',
  name: 'DeepSeek',
  models: [
    {
      id: 'deepseek-flash',
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'high'],
      },
      price: {
        tokens: 1_000_000,
      },
      forProjectMemory: true,
    },
    {
      id: 'deepseek-v4-pro',
      tools: ['web_search'],
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
