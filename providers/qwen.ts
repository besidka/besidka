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
      tools: ['web_search'],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.7-flash',
      name: 'Qwen3.7 Flash',
      description: 'Qwen vision-language model for visual reasoning, documents, and agent tasks',
      contextLength: 1_000_000,
      maxOutputTokens: 131_072,
      releaseDate: '2026-07-15',
      modalities: {
        input: ['text', 'image', 'video'],
        output: ['text'],
      },
      tools: ['web_search'],
      toolCall: true,
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
        input: 'from $0.03',
        output: 'from $0.13',
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
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.8-flash',
      tools: [],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.8-omni-flash',
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.6-max-preview',
      status: 'deprecated',
      retiredAt: '2026-10-10',
      tools: ['web_search'],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.6-plus',
      tools: ['web_search'],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.6-27b',
      tools: ['web_search'],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.6-35b-a3b',
      tools: ['web_search'],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.5-flash',
      name: 'Qwen3.5 Flash',
      description: 'Qwen vision-language model for visual reasoning, documents, and agent tasks',
      contextLength: 1_000_000,
      maxOutputTokens: 65_536,
      releaseDate: '2026-02-23',
      modalities: {
        input: ['text', 'image', 'video'],
        output: ['text'],
      },
      tools: ['web_search'],
      toolCall: true,
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
        input: '$0.10',
        output: '$0.40',
      },
    },
    {
      id: 'qwen3.5-plus',
      tools: ['web_search'],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.5-397b-a17b',
      tools: ['web_search'],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.5-122b-a10b',
      tools: ['web_search'],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.5-27b',
      tools: ['web_search'],
      reasoning: {
        mode: 'toggle',
      },
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3.5-35b-a3b',
      tools: ['web_search'],
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
      id: 'qwen3-omni-flash',
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
      status: 'deprecated',
      retiredAt: '2026-10-10',
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
      status: 'deprecated',
      retiredAt: '2026-10-10',
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
      status: 'deprecated',
      retiredAt: '2026-10-10',
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
      status: 'deprecated',
      retiredAt: '2026-10-10',
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
      status: 'deprecated',
      retiredAt: '2026-10-10',
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
      status: 'deprecated',
      retiredAt: '2026-10-10',
      tools: [],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qvq-max',
      status: 'deprecated',
      retiredAt: '2026-10-10',
      tools: [],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-next-80b-a3b-thinking',
      status: 'deprecated',
      retiredAt: '2026-10-10',
      tools: [],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-vl-235b-a22b',
      status: 'deprecated',
      retiredAt: '2026-10-10',
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
      status: 'deprecated',
      retiredAt: '2026-10-10',
      tools: ['web_search'],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-next-80b-a3b-instruct',
      status: 'deprecated',
      retiredAt: '2026-10-10',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-coder-plus',
      status: 'deprecated',
      retiredAt: '2026-10-10',
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
      status: 'deprecated',
      retiredAt: '2026-10-10',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen3-coder-30b-a3b-instruct',
      status: 'deprecated',
      retiredAt: '2026-10-10',
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
      status: 'deprecated',
      retiredAt: '2026-10-10',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen-vl-plus',
      status: 'deprecated',
      retiredAt: '2026-10-10',
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
      status: 'deprecated',
      retiredAt: '2026-10-10',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen-omni-turbo',
      status: 'deprecated',
      retiredAt: '2026-10-10',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen2-5-vl-72b-instruct',
      status: 'deprecated',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen2-5-vl-7b-instruct',
      status: 'deprecated',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen2-5-72b-instruct',
      status: 'deprecated',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen2-5-32b-instruct',
      status: 'deprecated',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen2-5-14b-instruct',
      status: 'deprecated',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'qwen2-5-7b-instruct',
      status: 'deprecated',
      tools: [],
      price: {
        tokens: 1_000_000,
      },
    },
  ],
} satisfies CuratedProvider
