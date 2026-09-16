import type { CuratedProvider } from './merge'

export default {
  id: 'qwen',
  name: 'Qwen',
  modelsDevKey: 'alibaba',
  models: [
    {
      id: 'qwen3.7-plus',
      tools: ['web_search'],
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
      tools: ['web_search'],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.8-max',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.8-flash',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.6-max-preview',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.6-plus',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.6-27b',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.6-35b-a3b',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.5-plus',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.5-397b-a17b',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.5-122b-a10b',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.5-27b',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.5-35b-a3b',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-vl-plus',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-235b-a22b',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-32b',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-14b',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-8b',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen-plus',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen-flash',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen-turbo',
      tools: [],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwq-plus',
      tools: [],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qvq-max',
      tools: [],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-next-80b-a3b-thinking',
      tools: [],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-vl-235b-a22b',
      tools: [],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-vl-30b-a3b',
      tools: [],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-max',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-next-80b-a3b-instruct',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-coder-plus',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-coder-flash',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-coder-480b-a35b-instruct',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-coder-30b-a3b-instruct',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen-max',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen-vl-max',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen-vl-plus',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen-vl-ocr',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen-plus-character-ja',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen-mt-plus',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen-mt-turbo',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen2-5-vl-72b-instruct',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen2-5-vl-7b-instruct',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen2-5-72b-instruct',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen2-5-32b-instruct',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen2-5-14b-instruct',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen2-5-7b-instruct',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
  ],
} satisfies CuratedProvider
