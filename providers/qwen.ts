import type { CuratedProvider } from './merge'

export default {
  id: 'qwen',
  name: 'Qwen',
  modelsDevKey: 'alibaba',
  models: [
    {
      id: 'qwen3.7-plus',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.7-max',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.6-flash',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
  ],
} satisfies CuratedProvider
