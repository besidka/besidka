import type { CuratedProvider } from './merge'

export default {
  id: 'openai',
  name: 'OpenAI',
  models: [
    {
      id: 'o3-deep-research',
      name: 'o3 Deep Research',
      description: 'Autonomous agent for exhaustive, cross-checked web research and cited reports on deep or high-stakes topics, around $10 per task',
      contextLength: 200_000,
      maxOutputTokens: 100_000,
      price: {
        tokens: 1_000_000,
        input: '$10.00',
        output: '$40.00',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text'],
      },
      tools: [],
      research: {
        tier: 'thorough',
        assistModel: 'gpt-5.4-nano',
        costEstimate: '~$10 / task',
        timeEstimate: '10–30 min',
        maxToolCalls: 60,
      },
    },
    {
      id: 'o4-mini-deep-research',
      name: 'o4-mini Deep Research',
      description: 'Autonomous agent that browses the web, cross-checks sources, and writes a cited research report for around $1 per task',
      contextLength: 200_000,
      maxOutputTokens: 100_000,
      price: {
        tokens: 1_000_000,
        input: '$2.00',
        output: '$8.00',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text'],
      },
      tools: [],
      research: {
        tier: 'quick',
        assistModel: 'gpt-5.4-nano',
        costEstimate: '~$1 / task',
        timeEstimate: '5–15 min',
        maxToolCalls: 30,
      },
    },
    {
      id: 'gpt-5.6-sol',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5.6-terra',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5.6-luna',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5.5',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5.4',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5.4-mini',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5.4-nano',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
      forProjectMemory: true,
    },
    {
      id: 'gpt-5.2',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5.1',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5-mini',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5-nano',
      price: {
        tokens: 1_000_000,
      },
      tools: ['image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-image-2',
      name: 'GPT Image 2',
      price: {
        tokens: 1,
        display: '$0.041–$0.053 / medium image, plus input',
      },
      tools: [],
      imageGeneration: {
        controllerModel: 'gpt-5-nano',
      },
    },
  ],
} satisfies CuratedProvider
