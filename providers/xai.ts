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
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'grok-4.20-multi-agent-0309',
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
      id: 'grok-4.6',
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
    {
      id: 'grok-4.3',
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
      id: 'grok-build-0.1',
      tools: ['web_search'],
      reasoningAlwaysOn: true,
      price: {
        tokens: 1_000_000,
      },
    },
    {
      id: 'grok-imagine-image-2.0',
      name: 'Grok Imagine Image 2.0',
      description: 'Image model for prompt-driven generation, editing, and visual design workflows',
      contextLength: 64_000,
      maxOutputTokens: 0,
      releaseDate: '2026-08-07',
      modalities: {
        input: ['text', 'image', 'pdf'],
        output: ['image'],
      },
      price: {
        tokens: 1,
        display: '$0.04 / image',
      },
      tools: [],
      toolCall: false,
      imageGeneration: {
        controllerModel: 'grok-4.20-0309-non-reasoning',
      },
    },
  ],
} satisfies CuratedProvider
