import type { CuratedProvider } from './merge'

export default {
  id: 'moonshotai',
  name: 'Moonshot AI',
  models: [
    {
      id: 'kimi-k2.6',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'kimi-k3',
      tools: [],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
  ],
} satisfies CuratedProvider
